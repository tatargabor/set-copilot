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
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

import type { CategoryRegistry } from "./categories.js";
import {
  type CanvasState, emptyCanvas, offerCandidate, nextSwap, commitSwap, overrideSwap,
} from "./director.js";
import type { EventSource } from "./event-source.js";
import { zoneMatches } from "./routing.js";
import {
  type DisplayEvent, type GraphEdge, type GraphNode, type Pacing, type ShowCommand,
  type WallWindow, type WireMessage, type Zone, isShowCommand,
} from "./types.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** One connected SSE client, tagged with the window it belongs to. */
interface Client {
  res: ServerResponse;
  zones: Zone[];
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
  windows: WallWindow[];
  registry: CategoryRegistry;
  /** Directory holding the static client assets (index.html, wall.js, …). */
  publicDir: string;
  /** How often the director re-evaluates paced canvas swaps. */
  directorTickMs?: number;
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
  /** category ids rendered by a non-paced `latest` slot (pinned items to replay). */
  private readonly pinnedCats = new Set<string>();

  constructor(opts: WallServerOptions) {
    this.opts = opts;
    this.indexSlots();
  }

  /** Precompute which categories are paced canvases vs pinned latest, from the windows. */
  private indexSlots(): void {
    for (const win of this.opts.windows) {
      for (const slot of win.slots) {
        for (const cat of slot.cats) {
          if (slot.behavior === "latest" && slot.pacing) {
            if (!this.canvases.has(cat)) this.canvases.set(cat, emptyCanvas());
            if (!this.pacing.has(cat)) this.pacing.set(cat, slot.pacing);
          } else if (slot.behavior === "latest") {
            this.pinnedCats.add(cat);
          }
        }
      }
    }
  }

  addSource(source: EventSource): void {
    this.sources.push(source);
  }

  start(): Promise<void> {
    this.http = createServer((req, res) => this.handle(req, res));
    for (const s of this.sources) s.start((m) => this.ingest(m));
    this.directorTimer = setInterval(() => this.runDirector(Date.now()), this.opts.directorTickMs ?? 500);
    return new Promise((resolve) => this.http!.listen(this.opts.port, resolve));
  }

  stop(): void {
    for (const s of this.sources) s.stop();
    if (this.directorTimer) clearInterval(this.directorTimer);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
    this.http?.close();
  }

  // ---- ingest + accumulate ----

  /** The single funnel every event source feeds. Accumulates state, then broadcasts. */
  ingest(msg: WireMessage): void {
    if (isShowCommand(msg)) {
      // An externally-supplied show command is honored as an immediate override.
      const canvas = this.canvases.get(msg.cat);
      if (canvas) overrideSwap(canvas, msg.id, Date.now());
      this.broadcast(msg);
      return;
    }
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
    if (this.pinnedCats.has(ev.category)) this.latest.set(ev.category, ev);
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

  private broadcast(msg: WireMessage): void {
    const zone: Zone | undefined = isShowCommand(msg) ? undefined : msg.zone;
    const payload = `data: ${JSON.stringify(msg)}\n\n`;
    for (const c of this.clients) {
      // Show commands reach every window; display events are zone-filtered.
      if (zone && !zoneMatches(zone, c.zones)) continue;
      c.res.write(payload);
    }
  }

  /** Send the current display state to a freshly-connected client (its zones only). */
  private replay(client: Client): void {
    // Pinned latest text items.
    for (const ev of this.latest.values()) {
      if (zoneMatches(ev.zone, client.zones)) client.res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    // Current graph per category: the shown visual's accumulated nodes/edges as one add.
    for (const [cat, canvas] of this.canvases) {
      const shown = canvas.current?.id;
      const byVisual = this.graphs.get(cat);
      if (!shown || !byVisual) continue;
      const g = byVisual.get(shown);
      if (!g) continue;
      const ev: DisplayEvent = { category: cat, zone: g.zone, visual: shown, graph: { op: "add", nodes: [...g.nodes.values()], edges: g.edges } };
      if (zoneMatches(ev.zone, client.zones)) {
        client.res.write(`data: ${JSON.stringify(ev)}\n\n`);
        client.res.write(`data: ${JSON.stringify({ kind: "show", cat, id: shown } satisfies ShowCommand)}\n\n`);
      }
    }
  }

  // ---- HTTP ----

  private windowFor(route: string): WallWindow | undefined {
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
      return this.json(res, { window: win, categories: this.opts.registry.list() });
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
    const client: Client = { res, zones: win.zones };
    this.clients.add(client);
    this.replay(client);
    res.on("close", () => this.clients.delete(client));
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
