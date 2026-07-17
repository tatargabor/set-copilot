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

/**
 * How a category is drawn.
 *  - `text`  → a DOM lane (súgás, riasztás)
 *  - `graph` → a Cytoscape node/edge diagram (architecture, relationships)
 *  - `chart` → a data chart (magnitude/trend) rendered as dependency-free SVG
 */
export type RenderType = "text" | "graph" | "chart";

/** How a slot treats the stream of events routed to it. */
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
 * A display event as it travels over SSE and sits in the canonical JSONL log.
 *
 * `category` is the only field the transport needs to route/render. `zone` gates
 * which windows see it. `speaker` preserves the load-bearing mic/system primitive
 * on text. `priority:"immediate"` means "broadcast now, bypass the director's
 * pacing" — set by alerts and scroll-log lines. `visual` groups graph deltas.
 */
export interface DisplayEvent {
  category: string;
  zone: Zone;
  /** Text payload for a `text`-render category. */
  text?: string;
  /** mic = "én", system = "mindenki más". Preserved, never re-invented. */
  speaker?: "mic" | "system";
  /** Broadcast at once, skipping dwell/freshness pacing. */
  priority?: "immediate";
  /** Groups graph deltas: same id → same visual; a new id via `op:"reset"` = topic boundary. */
  visual?: string;
  /** Graph payload for a `graph`-render category. */
  graph?: GraphDelta;
  /** Chart payload for a `chart`-render category. */
  chart?: ChartSpec;
}

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
}

/** Anything that can appear on the `/events` stream. */
export type WireMessage = DisplayEvent | ShowCommand;

export function isShowCommand(m: WireMessage): m is ShowCommand {
  return (m as ShowCommand).kind === "show";
}

// ---- config/data shapes ----------------------------------------------------

/** A category definition — the atom of the display model. Data, not code. */
export interface Category {
  id: string;
  label: string;
  icon: string;
  render: RenderType;
}

/** Pacing config for a `latest` slot, turning it into a playout-governed canvas. */
export interface Pacing {
  /** A shown item stays at least this long before a fresher candidate can swap in. */
  minDwellMs: number;
  /** Cross-fade duration on swap (client-side); 0 = hard cut. */
  crossFadeMs?: number;
}

/** One region of a window: where it sits, how it behaves, what it subscribes to. */
export interface Slot {
  /** grid-area name — becomes part of the window's `grid-template-areas`. */
  area: string;
  behavior: Behavior;
  /** Category ids this slot renders; events of other categories are ignored. */
  cats: string[];
  /** Present only on a `latest` slot that should be director-paced (a canvas). */
  pacing?: Pacing;
}

/** A window (view) — a route serving one zone-filtered slot layout. */
export interface WallWindow {
  name: string;
  /** URL path, e.g. "/" or "/wall". */
  route: string;
  /** Which event zones this window renders. */
  zones: Zone[];
  slots: Slot[];
}

/** The whole wall config section. Categories + windows are config/data, not `src/`. */
export interface WallConfig {
  /** TCP port the local HTTP server binds. */
  port: number;
  /** Category registry (declarative). May be augmented by a categories module. */
  categories: Category[];
  /**
   * Optional path (relative to project root) to a `categories.mjs` module that
   * default-exports `(ctx) => Category[]`, mirroring the `knowledge.adapter` seam.
   */
  categoriesModule?: string;
  /** The views. `/` and `/wall` are defaults; a new window is a new entry, no code. */
  windows: WallWindow[];
}
