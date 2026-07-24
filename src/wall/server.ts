/**
 * The wall HTTP + SSE server (design D5/D7).
 *
 * One `/events` SSE broadcast per window, filtered server-side by the window's
 * `zones` so a private súgás never reaches the public wall. State-replay on
 * connect rebuilds the current graph + pinned latest items for a window opened
 * mid-session. The playout director lives here too: it is authoritative, so
 * multiple walls swap the paced canvas together via broadcast `show` commands.
 *
 * The server ingests from any number of event sources (the fake-feed, a JSONL
 * tailer, a future producer) through a single `ingest()` funnel — it neither
 * knows nor cares which producer emitted a message.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";

import type { CategoryRegistry } from "./categories.js";
import {
  type CanvasState, emptyCanvas, offerCandidate, nextSwap, commitSwap, overrideSwap,
} from "./director.js";
import { normalizeEvent } from "./emit.js";
import type { EventSource } from "./event-source.js";
import { compileRedactor, splitForZones, type CompiledRedactor, type EventVariants } from "./redaction.js";
import { resolveEventCategory, windowCats, zoneMatches } from "./routing.js";
import {
  type DisplayEvent, type GraphDelta, type GraphEdge, type GraphNode, type Pacing, type RedactionConfig,
  type ResolvedWindow, type ShowCommand, type WireMessage, type Zone,
  isShowCommand, reachesPrivate, reachesPublic,
} from "./types.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * What `/media` will serve. An allowlist, not a denylist: the route exists to show
 * a picture, and anything outside this set is something a wall has no reason to
 * read out of the project.
 */
const MEDIA_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

/**
 * What the browser is told about a window.
 *
 * A box's `policy` is prompt material for the copilot — the client has no use for
 * it, and serving it would put the box's mandate on a page anyone in the room can
 * open. Stripped rather than filtered per-route: there is no view that needs it.
 */
function publicWindowShape(win: ResolvedWindow): ResolvedWindow {
  return {
    ...win,
    boxes: win.boxes.map(({ policy: _policy, ...box }) => box),
  };
}

/** One connected SSE client, tagged with the window it belongs to. */
interface Client {
  res: ServerResponse;
  zones: Zone[];
  /** Category ids some box in this window subscribes to — the window's whole appetite. */
  cats: Set<string>;
}

/**
 * One zone's slice of an accumulated visual: nodes by id, edges in order.
 *
 * A visual no longer carries a single zone (public-redaction D3). Its deltas are
 * accumulated into TWO zone slices — the `private` slice gets the original deltas,
 * the `public` slice gets the SCRUBBED deltas, and only when they reach that zone.
 * That is what closes the replay-laundering bug at its root: a public join replays
 * from the `public` slice, which never received the private deltas, so there is no
 * per-delta filtering to get wrong later.
 */
interface ZoneAccum {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** A contributing delta was scrubbed — drives the private-view redaction marker on replay. */
  redacted: boolean;
  /** At least one delta fed this slice (an empty slice is not replayed). */
  present: boolean;
}

/** The server's running accumulation of one visual, split by zone. */
interface AccumulatedGraph {
  private: ZoneAccum;
  public: ZoneAccum;
}

function emptyAccum(): ZoneAccum {
  return { nodes: new Map(), edges: [], redacted: false, present: false };
}

/** Fold one delta into a zone slice. `reset` starts the slice fresh (topic boundary). */
function applyDelta(acc: ZoneAccum, delta: GraphDelta, redacted: boolean): void {
  if (delta.op === "reset") {
    acc.nodes = new Map();
    acc.edges = [];
    acc.redacted = false;
    acc.present = false;
  }
  for (const n of delta.nodes ?? []) if (n && typeof n.id === "string") acc.nodes.set(n.id, n);
  for (const e of delta.edges ?? []) acc.edges.push(e);
  acc.present = true;
  if (redacted) acc.redacted = true;
}

export interface WallServerOptions {
  port: number;
  /**
   * Interface to bind. Defaults to loopback: the wall serves project files over
   * `/media` and shows a private view, and `listen(port)` alone binds 0.0.0.0 —
   * which put both on the LAN for anyone who could reach the port. A wall that
   * genuinely needs to be reachable from another machine opts in explicitly.
   */
  host?: string;
  /** Windows with layout + boxes already resolved — the server never sees the legacy form. */
  windows: ResolvedWindow[];
  registry: CategoryRegistry;
  /** Directory holding the static client assets (index.html, wall.js, …). */
  publicDir: string;
  /** How often the director re-evaluates paced canvas swaps. */
  directorTickMs?: number;
  /** Project root — the confinement boundary for `image` payloads served over `/media`. */
  projectRoot?: string;
  /**
   * Public-zone redaction taxonomy. Compiled once into the server's redactor; a
   * `both`/`public` event is scrubbed or withheld before any public client sees it.
   *
   * Omitting it runs with NO redaction — public-bound events pass unchanged. The
   * shipped default `/wall` carries a public narration TEXT box, so a caller that
   * reuses `cfg.wall.windows` MUST also pass `cfg.wall.redaction` (as `runWall` does),
   * or raw narration reaches the public wall. `loadConfig` always resolves a fail-safe
   * default (an empty pattern list falls back), so the CLI path is always covered.
   */
  redaction?: RedactionConfig;
  /** Recent lines per `scroll` category kept for connect-time replay (default 20). */
  scrollHistory?: number;
}

export class WallServer {
  private readonly opts: WallServerOptions;
  private http?: Server;
  private readonly clients = new Set<Client>();
  private readonly sources: EventSource[] = [];
  private directorTimer?: NodeJS.Timeout;

  // ---- accumulated display state (for replay + the director) ----
  /** category → visual id → accumulated graph, split into private/public zone slices. */
  private readonly graphs = new Map<string, Map<string, AccumulatedGraph>>();
  /**
   * category → last pinned `latest` event, split by zone: the private store keeps the
   * original (marked if redacted), the public store keeps the SCRUBBED copy. A late
   * public join replays only what the public store ever received.
   */
  private readonly latestPrivate = new Map<string, DisplayEvent>();
  private readonly latestPublic = new Map<string, DisplayEvent>();
  /** category → director canvas state, for categories that appear in a paced slot. */
  private readonly canvases = new Map<string, CanvasState>();
  /** category → the pacing config of its canvas slot. */
  private readonly pacing = new Map<string, Pacing>();
  /** Category ids whose last event is kept for replay to a late-joining client. */
  private readonly pinnedCats = new Set<string>();
  /** Category ids rendered by a `scroll` box — their recent lines are replayed, not just the last. */
  private readonly scrollCats = new Set<string>();
  /**
   * category → recent scroll lines, split by zone (wall-scroll-replay). A ring bounded
   * at `scrollN`: a reloading window replays the last N lines of each scroll lane, and a
   * restart rebuilds the ring from the canonical log through the same accumulate path.
   */
  private readonly scrollPrivate = new Map<string, DisplayEvent[]>();
  private readonly scrollPublic = new Map<string, DisplayEvent[]>();
  /** How many recent scroll lines per category to keep and replay. */
  private readonly scrollN: number;
  /** The compiled redaction taxonomy (null when no redaction configured). */
  private readonly redactor: CompiledRedactor | null;

  constructor(opts: WallServerOptions) {
    this.opts = opts;
    this.redactor = opts.redaction ? compileRedactor(opts.redaction) : null;
    this.scrollN = opts.scrollHistory && opts.scrollHistory > 0 ? Math.floor(opts.scrollHistory) : 20;
    this.indexBoxes();
  }

  /**
   * Precompute which categories are paced canvases, and which get their last event
   * kept for replay.
   *
   * Every subscribed category is replayable, not only the ones in a non-paced
   * `latest` box. The old rule assumed one render type per box: a chart category
   * always sat in its own pinned box, so "paced ⇒ graph ⇒ replayed by the graph
   * path" held. With one presentation box taking both `architektúra` and `metrika`,
   * that assumption made charts unreplayable — and a `scroll` alert box likewise —
   * so a wall opened mid-meeting came up missing content it used to show.
   */
  private indexBoxes(): void {
    for (const win of this.opts.windows) {
      for (const box of win.boxes) {
        for (const cat of box.cats) {
          if (box.behavior === "latest" && box.pacing) {
            if (!this.canvases.has(cat)) this.canvases.set(cat, emptyCanvas());
            if (!this.pacing.has(cat)) this.pacing.set(cat, box.pacing);
          }
          if (box.behavior === "scroll") this.scrollCats.add(cat);
          this.pinnedCats.add(cat);
        }
      }
    }
  }

  addSource(source: EventSource): void {
    this.sources.push(source);
  }

  /**
   * Bind first, wire up second. The event sources and the director timer start
   * only AFTER the socket is listening, so a failed bind (EADDRINUSE) rejects
   * cleanly with nothing running — the caller can construct a fresh server on the
   * next port. Binding-then-wiring also means a discarded attempt leaks no timer
   * and no half-started tailer. The bind error is surfaced as a rejection instead
   * of the default unhandled 'error' crash.
   */
  start(): Promise<void> {
    this.http = createServer((req, res) => this.handle(req, res));
    const host = this.opts.host ?? "127.0.0.1";
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        this.http!.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        this.http!.removeListener("error", onError);
        for (const s of this.sources) s.start((m) => this.ingest(m));
        this.directorTimer = setInterval(() => this.runDirector(Date.now()), this.opts.directorTickMs ?? 500);
        resolve();
      };
      this.http!.once("error", onError);
      this.http!.once("listening", onListening);
      this.http!.listen(this.opts.port, host);
    });
  }

  /** The port actually bound — useful when constructed with port 0 (tests, fallback). */
  boundPort(): number {
    const addr = this.http?.address();
    return addr && typeof addr === "object" ? addr.port : this.opts.port;
  }

  stop(): void {
    for (const s of this.sources) s.stop();
    if (this.directorTimer) clearInterval(this.directorTimer);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
    this.http?.close();
  }

  // ---- ingest + accumulate ----

  /**
   * The single funnel every event source feeds. Validates, accumulates, broadcasts.
   *
   * Validation lives HERE and not only in `wall-emit`, because the JSONL log is the
   * documented cross-process producer seam: anything that appends a line reaches
   * this method without passing through the CLI. Validating only on the way out of
   * `emitWallEvents` made every check — one-payload, media confinement, schema —
   * advisory decoration on one entry point rather than an enforced boundary.
   *
   * Show commands are server-authoritative (`emit.ts` already refuses to emit one):
   * a source that injects one can desync every wall, so they are dropped here too.
   */
  ingest(msg: WireMessage): void {
    if (isShowCommand(msg)) {
      console.warn(`[set-copilot] wall: dropping externally-supplied show command for "${msg.cat}" — show is server-only`);
      return;
    }
    const norm = normalizeEvent(msg, { projectRoot: this.opts.projectRoot });
    if (!norm.ok) {
      console.warn(`[set-copilot] wall: dropping invalid event (${norm.reason})`);
      return;
    }
    msg = norm.event;

    // Drop an event whose category is not in the registry at the funnel, with a
    // warning, rather than letting it accumulate graph state and reach clients
    // only to be silently ignored by every box's `cats` gate (display-categories:
    // "Drop an unknown category").
    if (!resolveEventCategory(msg, this.opts.registry)) return;

    // Split the event into its private and public variants ONCE, here in the shared
    // funnel, before any broadcast or accumulation (public-redaction: "Redaction runs
    // in the shared ingest funnel, before broadcast"). The JSONL tailer feeds this
    // same method, so a tailer-ingested event is redacted on identical terms.
    const variants = splitForZones(msg, this.redactor);

    this.accumulate(variants);
    this.broadcastEvent(variants);

    // A graph reset (new visual) offers a candidate to the director; an immediate
    // one overrides the dwell and shows now. Keyed on the ORIGINAL event's zone/visual.
    if (msg.graph?.op === "reset" && msg.visual && this.canvases.has(msg.category)) {
      const canvas = this.canvases.get(msg.category)!;
      const now = Date.now();
      if (msg.priority === "immediate") {
        overrideSwap(canvas, msg.visual, now);
        this.emitShow(msg.category, msg.visual, "immediate");
      } else {
        offerCandidate(canvas, msg.visual, now);
      }
    }
  }

  /**
   * Fold an event's zone variants into the accumulation. The private slice gets the
   * ORIGINAL delta (only when it reaches private); the public slice gets the SCRUBBED
   * delta (only when the public variant survived redaction and reaches public). A
   * withheld public variant simply never touches the public slice — which is exactly
   * why a later public join cannot replay it.
   */
  private accumulate(variants: EventVariants): void {
    const priv = variants.private;
    const pub = variants.public;

    if (priv.graph && priv.visual) {
      let byVisual = this.graphs.get(priv.category);
      if (!byVisual) this.graphs.set(priv.category, (byVisual = new Map()));
      let g = byVisual.get(priv.visual);
      if (!g) byVisual.set(priv.visual, (g = { private: emptyAccum(), public: emptyAccum() }));
      if (reachesPrivate(priv.zone)) applyDelta(g.private, priv.graph, variants.redacted);
      if (pub?.graph && reachesPublic(pub.zone)) applyDelta(g.public, pub.graph, false);
      return; // graphs replay through the accumulated-visual path, not `latest`
    }

    // A scroll category keeps a bounded ring of recent lines (replayed on connect);
    // a non-scroll pinned category keeps only its single latest. Both split by zone so
    // a public join never replays a line the public zone never received.
    if (this.scrollCats.has(priv.category)) {
      if (reachesPrivate(priv.zone)) this.pushScroll(this.scrollPrivate, priv.category, priv);
      if (pub && reachesPublic(pub.zone)) this.pushScroll(this.scrollPublic, priv.category, pub);
    } else if (this.pinnedCats.has(priv.category)) {
      if (reachesPrivate(priv.zone)) this.latestPrivate.set(priv.category, priv);
      if (pub && reachesPublic(pub.zone)) this.latestPublic.set(priv.category, pub);
    }
  }

  /** Append to a scroll ring, evicting the oldest beyond the configured cap. */
  private pushScroll(ring: Map<string, DisplayEvent[]>, cat: string, ev: DisplayEvent): void {
    let lines = ring.get(cat);
    if (!lines) ring.set(cat, (lines = []));
    lines.push(ev);
    if (lines.length > this.scrollN) lines.splice(0, lines.length - this.scrollN);
  }

  // ---- director ----

  private runDirector(now: number): void {
    for (const [cat, canvas] of this.canvases) {
      const pacing = this.pacing.get(cat)!;
      const target = nextSwap(canvas, pacing, now);
      if (target && target !== canvas.current?.id) {
        commitSwap(canvas, target, now);
        this.emitShow(cat, target);
      }
    }
  }

  // ---- broadcast + replay ----
  //
  // Two confidentiality layers now. Zone filtering routes an event to the windows
  // whose zones match (a `private` event never reaches a public window). ON TOP of
  // that, PUBLIC-ZONE REDACTION (public-redaction capability) scrubs or withholds a
  // `both`/`public` event's payload before a public client sees it — the earlier
  // field-list scrubber leaked, so this one walks the whole payload, withholds on a
  // matching URL, fails closed, and accumulates per-zone so a public join can never
  // replay private history. It is a shape-matcher, not a security boundary: `zone:
  // "private"` remains the only reliable way to keep something off the public wall.

  /** Is this a public-facing client — a window with no `private` in its zone filter? */
  private isPublicClient(client: Client): boolean {
    return !client.zones.includes("private");
  }

  /** Broadcast a display event's zone-appropriate variant to each client. */
  private broadcastEvent(variants: EventVariants): void {
    const privStr = `data: ${JSON.stringify(variants.private)}\n\n`;
    const pubStr = variants.public ? `data: ${JSON.stringify(variants.public)}\n\n` : null;
    for (const c of this.clients) {
      const isPub = this.isPublicClient(c);
      const ev = isPub ? variants.public : variants.private;
      if (!ev) continue; // withheld from the public zone
      // A display event must clear BOTH gates: its zone reaches the window, and the
      // window actually has a box for its category. The category gate matters even
      // apart from redaction: a `both` event no box asked for would otherwise sit on
      // a window's wire unrendered — data on the socket is data delivered.
      if (!zoneMatches(ev.zone, c.zones)) continue;
      if (!c.cats.has(ev.category)) continue;
      c.res.write(isPub ? pubStr! : privStr);
    }
  }

  /**
   * Emit a `show` for (cat, visual), zoned to where the visual actually lives
   * (public-redaction D4). The zone is derived from which accumulation slices the
   * visual has content in; and if the visual *id* itself matches redaction, the show
   * is kept off the public zone entirely — a sensitive id must not ride a public
   * show even on a visual that has public content.
   */
  private emitShow(cat: string, visual: string, priority?: "immediate"): void {
    let zone = this.showZoneFor(cat, visual);
    if (zone && reachesPublic(zone) && this.idMatchesRedaction(visual)) zone = "private";
    const show: ShowCommand = { kind: "show", cat, id: visual };
    if (priority) show.priority = priority;
    if (zone) show.zone = zone;
    this.broadcastShow(show);
  }

  /** Zone a `show` should carry: derived from which accumulation slices hold this visual. */
  private showZoneFor(cat: string, visual: string): Zone | undefined {
    const g = this.graphs.get(cat)?.get(visual);
    if (!g) return undefined;
    if (g.private.present && g.public.present) return "both";
    if (g.public.present) return "public";
    if (g.private.present) return "private";
    return undefined;
  }

  /** Does a visual id match a redaction pattern? Fail-closed: an evaluation error counts as a match. */
  private idMatchesRedaction(id: string): boolean {
    if (!this.redactor) return false;
    try { return this.redactor.matches(id); } catch { return true; }
  }

  /** Broadcast a `show` command, filtered by its zone (an absent zone reaches everyone). */
  private broadcastShow(show: ShowCommand): void {
    const payload = `data: ${JSON.stringify(show)}\n\n`;
    for (const c of this.clients) {
      if (show.zone && !zoneMatches(show.zone, c.zones)) continue;
      c.res.write(payload);
    }
  }

  /** Send the current display state to a freshly-connected client (its zones + categories only). */
  private replay(client: Client): void {
    const isPub = this.isPublicClient(client);
    const reaches = (ev: DisplayEvent) => zoneMatches(ev.zone, client.zones) && client.cats.has(ev.category);

    // Recent scroll-history per scroll category, oldest→newest so the lane reads in
    // order — from the zone-appropriate ring, so a public join never replays a private
    // line (wall-scroll-replay). Sent before the pinned latest, mirroring live arrival.
    for (const lines of (isPub ? this.scrollPublic : this.scrollPrivate).values()) {
      for (const ev of lines) {
        if (reaches(ev)) client.res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    }

    // Pinned latest items — from the zone-appropriate store, so a public join never
    // reconstructs from an event the public store never received.
    for (const ev of (isPub ? this.latestPublic : this.latestPrivate).values()) {
      if (reaches(ev)) client.res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }

    // Current graph per paced category: the shown visual's accumulated slice as one add.
    for (const [cat, canvas] of this.canvases) {
      const shown = canvas.current?.id;
      if (!shown) continue;
      const g = this.graphs.get(cat)?.get(shown);
      if (!g) continue;
      const acc = isPub ? g.public : g.private;
      if (!acc.present) continue; // this zone has nothing for this visual (D3: no laundering)
      // The visual id is producer text keyed on the ORIGINAL (unscrubbed) value, and
      // can itself be sensitive (D4). Live broadcast zones the show by id via emitShow;
      // replay must apply the SAME guard, or a late public join gets the raw id back in
      // both the reconstructed event's `visual` and its `show`. Fail-closed: skip it.
      if (isPub && this.idMatchesRedaction(shown)) continue;
      // The reconstructed event is routed to THIS client, so label it with a zone
      // that reaches this client. Mark it immediate so it renders at once (a deferred
      // graph add would leave the show with no slot built yet — the box came back blank).
      const zone: Zone = isPub ? "public" : "private";
      const ev: DisplayEvent = {
        category: cat, zone, visual: shown, priority: "immediate",
        graph: { op: "add", nodes: [...acc.nodes.values()], edges: acc.edges },
      };
      if (!isPub && acc.redacted) ev.redaction = "redacted"; // private-view marker
      if (reaches(ev)) {
        client.res.write(`data: ${JSON.stringify(ev)}\n\n`);
        client.res.write(`data: ${JSON.stringify({ kind: "show", cat, id: shown, zone } satisfies ShowCommand)}\n\n`);
      }
    }
  }

  // ---- HTTP ----

  private windowFor(route: string): ResolvedWindow | undefined {
    return this.opts.windows.find((w) => w.route === route);
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/events") {
      this.handleSse(url, res);
      return;
    }
    if (path === "/api/bootstrap") {
      const win = this.windowFor(url.searchParams.get("route") ?? "/");
      if (!win) return this.notFound(res);
      return this.json(res, { window: publicWindowShape(win), categories: this.opts.registry.list() });
    }
    if (path === "/media") {
      return this.serveMedia(res, url.searchParams.get("src") ?? "");
    }
    // A declared window route serves the static shell; other paths are assets.
    if (this.windowFor(path)) return this.serveFile(res, join(this.opts.publicDir, "index.html"));
    this.serveFile(res, join(this.opts.publicDir, "." + path));
  }

  private handleSse(url: URL, res: ServerResponse): void {
    const win = this.windowFor(url.searchParams.get("route") ?? "/");
    if (!win) return this.notFound(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 2000\n\n"); // native auto-reconnect interval
    const cats = windowCats(win.boxes);
    const client: Client = { res, zones: win.zones, cats };
    this.clients.add(client);
    this.replay(client);
    res.on("close", () => this.clients.delete(client));
  }

  /**
   * Serve an in-project `image` source.
   *
   * This handler answers whatever a browser asks for, so it re-derives every check
   * rather than trusting that the path came from a validated event. Three of them,
   * each closing a hole an adversarial pass actually walked through:
   *
   *  - **realpath, not string arithmetic.** `resolve`/`relative` are pure string
   *    operations; `existsSync`/`statSync` follow symlinks. A link inside the
   *    project pointing at `/etc` therefore passed a lexical check and was served.
   *    Projects grow such links by accident (`node_modules/.bin`, a `data ->` mount).
   *  - **An image route serves images.** Without an extension allowlist this was an
   *    unauthenticated read of every file under the project root — `.env`,
   *    `.git/config`, sources — reachable by anyone who could open the wall.
   *  - **A file, not a directory**, and only under the resolved root.
   */
  private serveMedia(res: ServerResponse, src: string): void {
    const root = this.opts.projectRoot;
    if (!root || !src || src.includes("\0")) return this.notFound(res);
    if (!MEDIA_EXTENSIONS.has(extname(src).toLowerCase())) return this.notFound(res);

    let realRoot: string;
    let abs: string;
    try {
      realRoot = realpathSync(resolve(root));
      abs = realpathSync(resolve(root, src));
    } catch {
      return this.notFound(res); // missing, or a broken link
    }
    const rel = relative(realRoot, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return this.notFound(res);
    if (!statSync(abs).isFile()) return this.notFound(res);

    res.writeHead(200, { "Content-Type": MIME[extname(abs).toLowerCase()] ?? "application/octet-stream" });
    res.end(readFileSync(abs));
  }

  private serveFile(res: ServerResponse, filePath: string): void {
    const safe = normalize(filePath);
    if (!safe.startsWith(normalize(this.opts.publicDir)) || !existsSync(safe) || !statSync(safe).isFile()) {
      return this.notFound(res);
    }
    res.writeHead(200, { "Content-Type": MIME[extname(safe)] ?? "application/octet-stream" });
    res.end(readFileSync(safe));
  }

  private json(res: ServerResponse, obj: unknown): void {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify(obj));
  }

  private notFound(res: ServerResponse): void {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}
