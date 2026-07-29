/**
 * The wall's category-tagged event schema and the config/data shapes for the
 * display model. Everything here is the display↔producer *contract* (design D6):
 * a producer emits these shapes, the display renders them, and the fake-feed and
 * the real `wall-producers` feed stay byte-compatible because both target it.
 *
 * The display is meaning-agnostic. An event carries a `category` label and a
 * payload; the display looks the category up in the registry and renders by its
 * `render` type. It never hard-codes "súgás" or "architektúra" — those live in
 * config, the same way `copilot.alerts` and `knowledge.keywords` do.
 */

/** Which windows an event is allowed to reach. `both` shows everywhere. */
export type Zone = "private" | "public" | "both";

/** Does an event of this zone reach the private view? (`private` and `both` do.) */
export function reachesPrivate(zone: Zone): boolean {
  return zone === "private" || zone === "both";
}

/** Does an event of this zone reach the public wall? (`public` and `both` do.) */
export function reachesPublic(zone: Zone): boolean {
  return zone === "public" || zone === "both";
}

/**
 * How a category is drawn.
 *  - `text`    → a DOM lane (súgás, riasztás)
 *  - `graph`   → a Cytoscape node/edge diagram (architecture, relationships)
 *  - `chart`   → a data chart (magnitude/trend) rendered as dependency-free SVG
 *  - `image`   → a local (in-project) file or remote URL
 *  - `webpage` → an embedded document
 *
 * The vocabulary is closed on purpose: it is an engine fact, not a config seam.
 * Extending it is an engine change (this list is where that change happens), so a
 * project cannot quietly invent a render type the client has no renderer for.
 *
 * A category's `render` is only the *default*. Which renderer actually runs is
 * decided by the payload the event carries — see `DisplayEvent`.
 */
export type RenderType = "text" | "graph" | "chart" | "image" | "webpage";

/** How a box treats the stream of events routed to it. */
export type Behavior = "scroll" | "latest";

/** A graph delta operation: append to the current visual, or start a fresh one. */
export type GraphOp = "add" | "reset";

/** A single node in a graph delta. Free-form beyond the required id. */
export interface GraphNode {
  id: string;
  label?: string;
  [k: string]: unknown;
}

/** A single edge in a graph delta. */
export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  [k: string]: unknown;
}

/** The `graph` payload on a graph-render event. */
export interface GraphDelta {
  op: GraphOp;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
}

/** One bar/point in a chart. */
export interface ChartDatum {
  label: string;
  value: number;
}

/**
 * The `chart` payload — a whole (small) chart per event, replace-on-newer like a
 * `latest` slot. Kept deliberately tiny: a single-series magnitude chart is the
 * common meeting case (latency, LOC, coverage). `unit` is appended to value labels.
 */
export interface ChartSpec {
  type: "bar";
  title?: string;
  unit?: string;
  data: ChartDatum[];
}

/**
 * The `image` payload. `src` is either an absolute URL or a path resolved inside
 * the project root — validated at ingest, never at render time, so a malformed or
 * escaping source never reaches a live display (design D4).
 */
export interface ImageSpec {
  src: string;
  caption?: string;
}

/** The `webpage` payload — an absolute URL embedded in the presentation box. */
export interface WebpageSpec {
  url: string;
  title?: string;
}

/**
 * A display event as it travels over SSE and sits in the canonical JSONL log.
 *
 * `category` is the only field the transport needs to route/render. `zone` gates
 * which windows see it. `speaker` preserves the load-bearing mic/system primitive
 * on text. `priority:"immediate"` means "broadcast now, bypass the director's
 * pacing" — set by alerts and scroll-log lines. `visual` groups graph deltas.
 *
 * An event carries EXACTLY ONE payload, and that payload — not the category's
 * `render` default — selects the renderer. This is what lets a single presentation
 * box show a diagram, then a chart, then an image, without the box or the layout
 * being redefined.
 */
export interface DisplayEvent {
  category: string;
  zone: Zone;
  /** Text payload. */
  text?: string;
  /** mic = "én", system = "mindenki más". Preserved, never re-invented. */
  speaker?: "mic" | "system";
  /** Broadcast at once, skipping dwell/freshness pacing. */
  priority?: "immediate";
  /** Groups graph deltas: same id → same visual; a new id via `op:"reset"` = topic boundary. */
  visual?: string;
  /** Graph payload. */
  graph?: GraphDelta;
  /** Chart payload. */
  chart?: ChartSpec;
  /** Image payload. */
  image?: ImageSpec;
  /** Embedded-page payload. */
  webpage?: WebpageSpec;
  /**
   * Set by the SERVER (never a producer) on the PRIVATE copy of a `both`/`public`
   * event whose public variant was scrubbed or withheld (public-redaction D7). The
   * private view renders a marker from it, so the operator sees what the audience
   * did not — regardless of payload type. Absent on the public copy and on anything
   * that passed through unredacted.
   */
  redaction?: "redacted" | "withheld";
  /**
   * Marks a predictive staged visual (predictive-staging D3): content prepared for
   * where the conversation is heading, drawn ahead into the PRIVATE zone during a
   * `silence` window. The server tracks a staged visual for the promote gate and for
   * expiry — it is a state marker, not geometry. A staged event is `zone:"private"` —
   * and this is *enforced*, not merely conventional: `normalizeEvent` rejects
   * `staged:true` on any non-private zone (fail-closed), so a single wrong zone character
   * can never publish a prediction. The zone model keeps it off every public client, and
   * it reaches the public wall only through an explicit `promote`.
   */
  staged?: boolean;
}

/**
 * The payload keys, in the order the renderer dispatches on. Exported so ingest
 * validation and the client agree on exactly one list — a payload added to
 * `DisplayEvent` but forgotten here would validate and then fail to render.
 */
export const PAYLOAD_KEYS = ["text", "graph", "chart", "image", "webpage"] as const;

export type PayloadKey = (typeof PAYLOAD_KEYS)[number];

/** Which render type a given payload key selects. */
export const PAYLOAD_RENDER: Record<PayloadKey, RenderType> = {
  text: "text",
  graph: "graph",
  chart: "chart",
  image: "image",
  webpage: "webpage",
};

/**
 * A director command. Emitted server-side (authoritative playout) to tell every
 * wall to swap a paced canvas slot to a specific visual at the same moment.
 */
export interface ShowCommand {
  kind: "show";
  /** The category whose paced slot should swap. */
  cat: string;
  /** The `visual` id to show. */
  id: string;
  priority?: "immediate";
  /**
   * The referenced visual's zone (public-redaction D4). A `show` carries a `visual`
   * id that is free producer text and can itself be sensitive, so it is broadcast
   * only to clients whose zone matches — a `private` visual's `show` never reaches a
   * public client. Omitted only for legacy paths; broadcast treats an absent zone as
   * `both` (reaches everyone), which is why the server always sets it.
   */
  zone?: Zone;
}

/**
 * A server-authoritative liveness heartbeat (wall-liveness D1). Broadcast to every
 * client on a fixed timer, derived by the server from the runtime dir it serves — the
 * capture PID and the transcript's freshness — never from the copilot. The thing whose
 * aliveness is in question (the copilot) cannot be the source of the aliveness signal,
 * so a stalled copilot can never make the wall look dead while capture is still running.
 * Server-only, exactly like `show`: an injected heartbeat from an event source is dropped.
 */
export interface Heartbeat {
  kind: "heartbeat";
  /** Is the capture process for this runtime dir alive (PID file present + reachable)? */
  captureAlive: boolean;
  /** Age in ms of the newest transcript line, or null if nothing has been heard yet. */
  lastHeardMsAgo: number | null;
}

/**
 * A lightweight "working" marker (wall-pending-indicator D3). When the copilot starts a
 * fork-based draw that takes seconds, it emits a pending marker so the target box shows a
 * placeholder at once — legible instead of indistinguishable from a dead wall. It is NOT
 * content: it carries a category and a short label, never a payload to render as final,
 * so it is deliberately kept apart from `PAYLOAD_KEYS`. It is transient — the first real
 * payload for the box clears it, and `ttlMs` clears it if the draw dies — and zoned like
 * any event (D4): a `private` pending never reaches a public client.
 */
export interface Pending {
  kind: "pending";
  category: string;
  zone: Zone;
  /** One-line description of what is being drawn, shown beside the spinner. */
  label: string;
  /** Self-expiry in ms; the client drops the placeholder if nothing replaces it in time. */
  ttlMs?: number;
}

/**
 * Lift a staged private visual into a target zone (predictive-staging D3). Triggered by
 * the operator/skill after the gate fires (the conversation reached the predicted topic,
 * or a single confirmation) — NOT autonomous. The server re-runs the already-prepared
 * visual through the normal ingest funnel, so promoting into a `both`/public zone passes
 * the SAME public-zone redaction as any other event: promotion is a cheap zone-lift of an
 * existing draw, never a re-draw, and never a bypass of redaction.
 *
 * Trust boundary: unlike `show`/`heartbeat`/`stage-expired`, a promote is NOT server-only
 * — it is the operator/skill's act, and the gate is *who may append to the canonical log*
 * (the documented producer seam), not a server check. An injected promote can therefore
 * lift a currently-staged visual, but the lift still runs through redaction, so the worst
 * case is a prematurely-published *redacted* prediction, never raw private content.
 */
export interface Promote {
  kind: "promote";
  category: string;
  /** The staged visual's id. */
  visual: string;
  /** Target zone for the lift. Default `public`. */
  zone?: Zone;
}

/**
 * A staged prediction that expired unused (predictive-staging D4). Broadcast to the
 * PRIVATE view only, so a stale guess is marked (and released) rather than lingering as
 * visual noise — and, once expired, it is no longer eligible for promotion. Server-only,
 * like `show`/`heartbeat`: a producer that injects one is dropped.
 */
export interface StageExpired {
  kind: "stage-expired";
  category: string;
  visual: string;
}

/**
 * A runtime layout switch (wall-chat-mirror). Reshapes ONE window's geometry while
 * the wall is live — no server restart — by swapping which named layout its route
 * uses. It is geometry only (display-layout MODIFIED): the target route's box
 * definitions, their behavior, pacing, and subscriptions are untouched; only the
 * grid the boxes sit in changes. The `layout` id must be present in the registry, or
 * the switch is dropped with a warning (never blanking the window), exactly as an
 * unknown layout is dropped at resolve time.
 *
 * Trust class matches `promote`, not `show`: it is the operator/skill's act, appended
 * to the canonical log through the documented producer seam, not server-authoritative.
 * The worst an injected switch can do is rearrange a window into another *configured*
 * layout — it carries no content, so it can neither publish nor leak anything.
 */
export interface LayoutSwitch {
  kind: "layout";
  /** Window route to reshape, e.g. "/" or "/wall". */
  route: string;
  /** The layout id to switch to — validated against the config's layout registry. */
  layout: string;
}

/** Anything that can appear on the `/events` stream. */
export type WireMessage = DisplayEvent | ShowCommand | Heartbeat | Pending | Promote | StageExpired | LayoutSwitch;

export function isShowCommand(m: WireMessage): m is ShowCommand {
  return (m as ShowCommand).kind === "show";
}

export function isHeartbeat(m: WireMessage): m is Heartbeat {
  return (m as Heartbeat).kind === "heartbeat";
}

export function isPending(m: WireMessage): m is Pending {
  return (m as Pending).kind === "pending";
}

export function isPromote(m: WireMessage): m is Promote {
  return (m as Promote).kind === "promote";
}

export function isStageExpired(m: WireMessage): m is StageExpired {
  return (m as StageExpired).kind === "stage-expired";
}

export function isLayoutSwitch(m: WireMessage): m is LayoutSwitch {
  return (m as LayoutSwitch).kind === "layout";
}

// ---- config/data shapes ----------------------------------------------------

/** A category definition — the atom of the display model. Data, not code. */
export interface Category {
  id: string;
  label: string;
  icon: string;
  render: RenderType;
}

/** Pacing config for a `latest` box, turning it into a playout-governed canvas. */
export interface Pacing {
  /** A shown item stays at least this long before a fresher candidate can swap in. */
  minDwellMs: number;
  /** Cross-fade duration on swap (client-side); 0 = hard cut. */
  crossFadeMs?: number;
}

/**
 * A *layout* — the geometry layer. It names box positions and how they are
 * arranged, and knows nothing about what will be shown in them (design D2).
 *
 * `areas` is the grid, row by row: `[["left","right"]]` is one row of two
 * positions; `[["a"],["b"]]` is two stacked rows. Position names may repeat
 * across cells to span. `columns`/`rows` are CSS track sizes; omit `rows` and the
 * client derives each row's size from the box occupying it, which is what keeps
 * the shipped stacked layout byte-identical to the pre-layout behavior.
 */
export interface WallLayout {
  id: string;
  areas: string[][];
  columns?: string[];
  rows?: string[];
}

/**
 * A *box* — the content layer. It carries behavior, pacing, subscriptions, and its
 * own optional policy, and knows nothing about where it sits. Moving a box to a
 * different position must not change how it behaves (design D2).
 */
export interface WallBox {
  behavior: Behavior;
  /** Category ids this box renders; events of other categories are ignored. */
  cats: string[];
  /** Present only on a `latest` box that should be director-paced (a canvas). */
  pacing?: Pacing;
  /**
   * Box-scoped content policy. Merged key-by-key over the session-global
   * `copilot.*` policy, so a box that declares nothing inherits the global one
   * unchanged (design D5).
   *
   * Typed from config.ts, which is a type-only cycle (config.ts already imports
   * these shapes): erased at runtime, and the alternative would be duplicating the
   * alert/engagement unions here, where they do not belong.
   */
  policy?: import("../config.js").BoxPolicy;
}

/** One region of a window. **Legacy** — superseded by layout + boxes, still accepted on the way in. */
export interface Slot {
  /** grid-area name — becomes part of the window's `grid-template-areas`. */
  area: string;
  behavior: Behavior;
  /** Category ids this slot renders; events of other categories are ignored. */
  cats: string[];
  /** Present only on a `latest` slot that should be director-paced (a canvas). */
  pacing?: Pacing;
}

/**
 * A window (view) — a route serving one zone-filtered layout.
 *
 * Two accepted forms: the current `layout` + `boxes` pair, and the legacy `slots`
 * list, which resolves onto the `stacked` layout so an existing config keeps
 * working and keeps looking identical. Everything downstream of `resolveWindow`
 * sees only the resolved form.
 */
/**
 * Who is looking at this surface (wall-public-surface D1).
 *
 * A DIFFERENT AXIS from `zones`. `zones` answers "what may this window display?";
 * `audience` answers "is a live audience looking at it?". Conflating them is what put a
 * leak in the wall: the audience used to be INFERRED as `!zones.includes("private")`, so an
 * operator who widened a public window's zones to show more silently turned redaction OFF
 * in front of a room.
 *
 * `"operator"` rather than `"private"` deliberately — it must not read as a fourth zone.
 * And it is a DISPLAY audience, not access control: `zone: "private"` remains the only
 * reliable way to keep content off a public wall.
 */
export type Audience = "public" | "operator";

export interface WallWindow {
  name: string;
  /** URL path, e.g. "/" or "/wall". */
  route: string;
  /** Which event zones this window renders. */
  zones: Zone[];
  /** Who is watching. Absent or unreadable resolves to `"public"` — fail closed. */
  audience?: Audience;
  /** Layout id, resolved against `WallConfig.layouts`. */
  layout?: string;
  /** Position name → the box occupying it. */
  boxes?: Record<string, WallBox>;
  /** Legacy slot list. Mutually exclusive with `layout`/`boxes`. */
  slots?: Slot[];
}

/** A box together with the position it was assigned to. */
export interface ResolvedBox extends WallBox {
  position: string;
}

/** A window with its layout and boxes resolved — the only form the server and client see. */
export interface ResolvedWindow {
  name: string;
  route: string;
  zones: Zone[];
  /** Resolved, never optional: every consumer reads a decided value, not a maybe. */
  audience: Audience;
  layout: WallLayout;
  boxes: ResolvedBox[];
}

/**
 * The public-zone redaction *taxonomy* — config, never `src/` (public-redaction:
 * "The redaction taxonomy is config, never code"). The *mechanism* (recursive walk,
 * URL withholding, fail-closed, ReDoS bound) is engine, in `redaction.ts`; this is
 * the project-specific part: which patterns mark something sensitive.
 *
 * The shipped default is domain-neutral — a marking convention (`[belső]` /
 * `[internal]`), not one project's names — so a fresh project never silently
 * redacts, or fails to redact, against another project's vocabulary.
 */
export interface RedactionConfig {
  /**
   * Regex sources applied to every string leaf of a public-bound event. Authored
   * with Unicode classes (`\p{L}\p{N}`), never `\b` — `\b` treats `á` as a boundary
   * and breaks every accented language. Compiled with the `u` flag; an invalid or
   * catastrophic-backtracking pattern is dropped at load with a conspicuous warning.
   */
  patterns: string[];
  /** What a matched span in a content string becomes. Default `[…]`. */
  replacement: string;
  /**
   * Longest string leaf the redactor will evaluate. A longer leaf on a public-bound
   * event is withheld rather than scanned (fail-closed) — one half of the ReDoS
   * bound, the other being static rejection of nested quantifiers at load.
   */
  maxInputLength: number;
}

/** The whole wall config section. Categories, layouts + windows are config/data, not `src/`. */
export interface WallConfig {
  /** TCP port the local HTTP server binds. */
  port: number;
  /** Category registry (declarative). May be augmented by a categories module. */
  categories: Category[];
  /** Public-zone redaction taxonomy (patterns + marking convention). Engine is `redaction.ts`. */
  redaction: RedactionConfig;
  /**
   * How many recent lines per `scroll`-behavior category the server keeps for
   * connect-time replay, so a reloading window sees recent text instead of a blank
   * lane (wall-scroll-replay). Default 20. Bounded on purpose: unbounded history
   * would grow without limit.
   */
  scrollHistory: number;
  /**
   * Predictive-staging expiry (predictive-staging D4). A staged prediction not promoted
   * within `ttlMs` is released with a private-view marker and becomes non-promotable, so
   * a stale guess never lingers as visual noise or publishes late in the wrong context.
   */
  staging: { ttlMs: number };
  /**
   * Optional path (relative to project root) to a `categories.mjs` module that
   * default-exports `(ctx) => Category[]`, mirroring the `knowledge.adapter` seam.
   */
  categoriesModule?: string;
  /** Named layouts. A window picks one by id; swapping the id reshapes the window. */
  layouts: WallLayout[];
  /** The views. `/` and `/wall` are defaults; a new window is a new entry, no code. */
  windows: WallWindow[];
}
