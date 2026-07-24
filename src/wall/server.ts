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
import { windowCats, zoneMatches } from "./routing.js";
import {
  type DisplayEvent, type GraphEdge, type GraphNode, type Pacing,
  type ResolvedWindow, type ShowCommand, type WireMessage, type Zone, isShowCommand,
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

/** The server's running accumulation of one visual: nodes by id, edges in order. */
interface AccumulatedGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** The zone the visual's events carried — so replay filters it like the live stream did. */
  zone: Zone;
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
}

export class WallServer {
  private readonly opts: WallServerOptions;
  private http?: Server;
  private readonly clients = new Set<Client>();
  private readonly sources: EventSource[] = [];
  private directorTimer?: NodeJS.Timeout;

  // ---- accumulated display state (for replay + the director) ----
  /** category → visual id → accumulated graph (nodes deduped by id, edges appended). */
  private readonly graphs = new Map<string, Map<string, AccumulatedGraph>>();
  /** category → last event for a pinned `latest` (non-paced) category. */
  private readonly latest = new Map<string, DisplayEvent>();
  /** category → director canvas state, for categories that appear in a paced slot. */
  private readonly canvases = new Map<string, CanvasState>();
  /** category → the pacing config of its canvas slot. */
  private readonly pacing = new Map<string, Pacing>();
  /** Category ids whose last event is kept for replay to a late-joining client. */
  private readonly pinnedCats = new Set<string>();

  constructor(opts: WallServerOptions) {
    this.opts = opts;
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
    this.accumulate(msg);
    this.broadcast(msg);

    // A graph reset (new visual) offers a candidate to the director; an immediate
    // one overrides the dwell and shows now.
    if (msg.graph?.op === "reset" && msg.visual && this.canvases.has(msg.category)) {
      const canvas = this.canvases.get(msg.category)!;
      const now = Date.now();
      if (msg.priority === "immediate") {
        overrideSwap(canvas, msg.visual, now);
        this.broadcast({ kind: "show", cat: msg.category, id: msg.visual });
      } else {
        offerCandidate(canvas, msg.visual, now);
      }
    }
  }

  private accumulate(ev: DisplayEvent): void {
    if (ev.graph && ev.visual) {
      let byVisual = this.graphs.get(ev.category);
      if (!byVisual) this.graphs.set(ev.category, (byVisual = new Map()));
      if (ev.graph.op === "reset") byVisual.set(ev.visual, { nodes: new Map(), edges: [], zone: ev.zone });
      let g = byVisual.get(ev.visual);
      if (!g) byVisual.set(ev.visual, (g = { nodes: new Map(), edges: [], zone: ev.zone }));
      g.zone = ev.zone;
      for (const n of ev.graph.nodes ?? []) if (n && typeof n.id === "string") g.nodes.set(n.id, n);
      for (const e of ev.graph.edges ?? []) g.edges.push(e);
    }
    // Graph events replay through the accumulated-visual path below, so keeping
    // them here too would replay the same picture twice.
    if (this.pinnedCats.has(ev.category) && !ev.graph) this.latest.set(ev.category, ev);
  }

  // ---- director ----

  private runDirector(now: number): void {
    for (const [cat, canvas] of this.canvases) {
      const pacing = this.pacing.get(cat)!;
      const target = nextSwap(canvas, pacing, now);
      if (target && target !== canvas.current?.id) {
        commitSwap(canvas, target, now);
        this.broadcast({ kind: "show", cat, id: target });
      }
    }
  }

  // ---- broadcast + replay ----
  //
  // Zone filtering is the whole confidentiality story for now: a `private`/`both`
  // event never reaches a `public`-only window. Automatic PUBLIC-ZONE REDACTION
  // (scrubbing a `both` event on its way to the public wall) was designed and
  // prototyped here, then pulled — an adversarial pass showed the field-list
  // scrubber leaked free-form payload keys, URLs, and replayed private graph
  // history. It is deferred to its own change (see `wall-public-redaction`), and
  // until it lands the shipped default wall is private-only.

  private broadcast(msg: WireMessage): void {
    const payload = `data: ${JSON.stringify(msg)}\n\n`;
    for (const c of this.clients) {
      // Show commands reach every window (they carry no content, only a swap).
      if (isShowCommand(msg)) { c.res.write(payload); continue; }
      // A display event must clear BOTH gates: its zone reaches the window, and the
      // window actually has a box for its category. The category gate matters even
      // with the wall private: a `both`-zone hint would otherwise sit on the public
      // window's wire with no box to render it — data on the socket is data leaked,
      // rendered or not.
      if (!zoneMatches(msg.zone, c.zones)) continue;
      if (!c.cats.has(msg.category)) continue;
      c.res.write(payload);
    }
  }

  /** Send the current display state to a freshly-connected client (its zones + categories only). */
  private replay(client: Client): void {
    const reaches = (ev: DisplayEvent) => zoneMatches(ev.zone, client.zones) && client.cats.has(ev.category);
    // Pinned latest text items.
    for (const ev of this.latest.values()) {
      if (reaches(ev)) client.res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    // Current graph per category: the shown visual's accumulated nodes/edges as one add.
    for (const [cat, canvas] of this.canvases) {
      const shown = canvas.current?.id;
      const byVisual = this.graphs.get(cat);
      if (!shown || !byVisual) continue;
      const g = byVisual.get(shown);
      if (!g) continue;
      // Reconstruction, not a live swap: mark it immediate so the client renders it
      // at once. Without this, a box that had also shown a chart puts the replayed
      // graph behind the paced dwell — the graph `add` is deferred, the `show` that
      // follows finds no graph slot built yet and is dropped, and the box comes back
      // blank on refresh even though the graph is still current.
      const ev: DisplayEvent = { category: cat, zone: g.zone, visual: shown, priority: "immediate", graph: { op: "add", nodes: [...g.nodes.values()], edges: g.edges } };
      if (reaches(ev)) {
        client.res.write(`data: ${JSON.stringify(ev)}\n\n`);
        client.res.write(`data: ${JSON.stringify({ kind: "show", cat, id: shown } satisfies ShowCommand)}\n\n`);
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
