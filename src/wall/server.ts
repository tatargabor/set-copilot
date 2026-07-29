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
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";

import type { CategoryRegistry } from "./categories.js";
import { channelActivity, type ChannelActivitySet } from "./channels.js";
import {
  type CanvasState, emptyCanvas, offerCandidate, nextSwap, commitSwap, overrideSwap,
} from "./director.js";
import { normalizeEvent, normalizePending, normalizePromote } from "./emit.js";
import type { EventSource } from "./event-source.js";
import { compileRedactor, splitForZones, type CompiledRedactor, type EventVariants } from "./redaction.js";
import { resolveEventCategory, windowCats, zoneMatches } from "./routing.js";
import {
  type Audience, type DisplayEvent, type GraphDelta, type GraphEdge, type GraphNode, type Heartbeat, type LayoutSwitch, type Pacing,
  type Pending, type Promote, type RedactionConfig, type ResolvedWindow, type ShowCommand, type StageExpired,
  type WallLayout, type WireMessage, type Zone,
  isHeartbeat, isLayoutSwitch, isPending, isPromote, isShowCommand, isStageExpired, reachesPrivate, reachesPublic,
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
 * How much of the transcript's tail the per-channel heartbeat reads (wall-viewport-and-activity).
 *
 * A meeting transcript grows to megabytes and this runs once a second, so the whole file is
 * out of the question; the newest line per channel is near the end by definition. 256 KB is
 * several thousand lines — far more than a one-sided stretch long enough to matter, and a
 * channel whose newest line has fallen outside it reads as "nothing heard", which is the
 * honest answer at that point anyway.
 */
const CHANNEL_TAIL_BYTES = 256 * 1024;

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
  /** The window route this client opened — a runtime layout switch targets a route. */
  route: string;
  zones: Zone[];
  /**
   * Who is watching. Carried from the window's DECLARATION, never re-derived from
   * `zones` — see `isPublicClient`.
   */
  audience: Audience;
  /** Category ids some box in this window subscribes to — the window's whole appetite. */
  cats: Set<string>;
}

/**
 * One retained broadcast, kept so a reconnecting client can be given what it missed
 * (wall-stream-recovery D1).
 *
 * It stores what was broadcast, NOT what any particular client received: the zone and
 * category gates are re-applied per client at resume time, through the same predicates
 * the live broadcast uses. Storing a per-client rendering would make resume a second
 * delivery path with its own copy of the zone rules — the one thing this must not be,
 * since a public client resuming across a private event is exactly the leak to avoid.
 */
interface TailEntry {
  seq: number;
  kind: "event" | "show" | "pending" | "stage-expired" | "layout";
  /** kind === "event": both zone variants, `public: null` meaning withheld. */
  variants?: EventVariants;
  /** every other kind: the message as broadcast, still carrying its own gate fields. */
  msg?: Record<string, unknown>;
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
  /**
   * The named-layout registry (wall-chat-mirror). Needed for a runtime layout switch:
   * a `layout` command names a layout id, and the server looks it up here before
   * reshaping a window. Omitting it disables runtime switching (a `layout` command is
   * dropped with a warning) — the resolved `windows` already carry their initial layout.
   */
  layouts?: WallLayout[];
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
  /**
   * The runtime dir this wall serves (wall-liveness D1). Enables the server-derived
   * heartbeat: the capture PID lives at `<runtimeDir>/capture.pid`, checked exactly as
   * `stop`/`poll` check it. Absent → no heartbeat is broadcast (a wall with no capture
   * to watch, e.g. a unit test that only exercises the event path).
   */
  runtimeDir?: string;
  /**
   * Path to the transcript whose freshness feeds `lastHeardMsAgo` (meeting mode). Its
   * mtime is the "last heard" clock; absent or missing → `null` (nothing heard yet).
   */
  transcriptPath?: string;
  /**
   * Path the *dictation* transcript would take for this runtime dir. Only used to tell a
   * `--mic-only` capture apart from a meeting one: the capture records which file it
   * writes in `capture.output`, and a match here is what makes the system channel report
   * as **absent** rather than silent (wall-viewport-and-activity D5). Omitting it means a
   * dictation capture's system channel reads as present-but-quiet — the pre-existing
   * behavior, never a leak of anything.
   */
  dictationPath?: string;
  /** How often the liveness heartbeat is broadcast. Default 1000 ms. */
  heartbeatMs?: number;
  /**
   * How long a staged prediction stays promotable before it expires (predictive-staging
   * D4). After this, a promote is refused and the private view is told to release it.
   * Default 120000. Set 0 to disable staging expiry (predictions never auto-expire).
   */
  stagingTtlMs?: number;
  /** How often to sweep for expired staged predictions. Default 5000 ms. */
  stagingSweepMs?: number;
}

export class WallServer {
  private readonly opts: WallServerOptions;
  private http?: Server;
  private readonly clients = new Set<Client>();
  private readonly sources: EventSource[] = [];
  private directorTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private stagingTimer?: NodeJS.Timeout;
  /**
   * Live staged predictions: `${category}\0${visual}` → stagedAt (predictive-staging).
   * A visual is promotable only while it is in this map; expiry (or a promote) removes
   * it. Normal private visuals never enter it — only events carrying `staged:true` do —
   * so an ordinary private graph is neither expirable nor promotable-by-accident.
   */
  private readonly staged = new Map<string, number>();

  // ---- resumable delivery (wall-stream-recovery) ----
  //
  // The wall's most-repeated field failure is that it goes stale and only a hard reload
  // brings it back. The browser's native reconnect already fires; what was missing is that
  // the server re-ran history the client was already showing, so a reconnect could not be
  // made idempotent. Riding the SSE `id:` field means the BROWSER tracks the cursor and
  // re-presents it as `Last-Event-ID` — no handshake, no query parameter, no client state.

  /**
   * Identity of THIS server run. A restarted server's counter starts over, so without it
   * a stale "id 40" would look satisfiable and the client would be told it is up to date
   * while silently missing everything — the exact failure class this change removes.
   */
  private readonly runId = `${process.pid}-${Date.now().toString(36)}`;
  private seq = 0;
  private readonly tail: TailEntry[] = [];
  /**
   * How many broadcasts stay resumable. Deliberately small: the observed field
   * disconnection was ~13 minutes, far past any sane buffer, so the FALLBACK is the common
   * path and is what deserves to be good (D2). This is the scroll ring's bounding
   * discipline, one order up.
   */
  private readonly tailN = 200;

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
  /**
   * Active runtime layout override per route (wall-chat-mirror). A `layout` command sets
   * one; the bootstrap for that route then serves the overridden geometry, so a client
   * that connects AFTER a switch comes up already in the new layout. Geometry only — the
   * window's boxes (behavior, pacing, subscriptions) are unchanged.
   */
  private readonly layoutOverrides = new Map<string, WallLayout>();

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
        // The liveness heartbeat runs only when we have a runtime dir to watch — there
        // is nothing to report aliveness of otherwise (wall-liveness D1).
        if (this.opts.runtimeDir) {
          this.heartbeatTimer = setInterval(
            () => this.broadcastHeartbeat(this.computeHeartbeat(Date.now())),
            this.opts.heartbeatMs ?? 1000,
          );
        }
        // Sweep expired staged predictions (predictive-staging D4). Disabled when the
        // ttl is 0 — predictions then never auto-expire.
        if ((this.opts.stagingTtlMs ?? 120_000) > 0) {
          this.stagingTimer = setInterval(() => this.sweepStaged(Date.now()), this.opts.stagingSweepMs ?? 5000);
        }
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
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.stagingTimer) clearInterval(this.stagingTimer);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
    this.http?.close();
  }

  // ---- liveness heartbeat (wall-liveness) ----
  //
  // Derived by the server from the runtime dir, never from the copilot: the thing
  // whose aliveness is in question cannot be the source of the signal. A stalled or
  // dead copilot therefore cannot make the wall look dead while capture still runs.

  /** Build the current heartbeat from the capture PID + transcript freshness. */
  private computeHeartbeat(now: number): Heartbeat {
    const active = this.activeTranscript();
    return {
      kind: "heartbeat",
      captureAlive: this.captureAlive(),
      lastHeardMsAgo: this.fileAgeMs(active, now),
      channels: this.channelActivity(active, now),
    };
  }

  /**
   * The transcript the RUNNING capture is actually writing.
   *
   * `capture.output` is written by the capture itself and is the only thing that knows
   * whether this run is dictation or meeting mode — the same marker `stop` and `status`
   * read. Following it (rather than the configured meeting path) is what keeps the
   * heartbeat honest during a `--mic-only` run, where the configured path is a stale file
   * from a previous meeting and its mtime would report an age from another session.
   */
  private activeTranscript(): string | undefined {
    const dir = this.opts.runtimeDir;
    if (dir) {
      const marker = join(dir, "capture.output");
      if (existsSync(marker)) {
        try {
          const p = readFileSync(marker, "utf-8").trim();
          if (p) return p;
        } catch { /* fall through to the configured path */ }
      }
    }
    return this.opts.transcriptPath;
  }

  /**
   * Per-channel activity for the heartbeat (D5).
   *
   * Reads only the TAIL of the transcript: a three-hour meeting is megabytes and this runs
   * once a second, while the newest line per channel is by definition near the end. The
   * window is large enough to hold both channels' newest lines through a long one-sided
   * stretch; if a channel's newest line falls outside it, that channel reports "nothing
   * heard" — which at that point is the honest reading anyway.
   */
  private channelActivity(path: string | undefined, now: number): ChannelActivitySet | undefined {
    if (!path || !existsSync(path)) return undefined;
    const micOnly = !!this.opts.dictationPath && path === this.opts.dictationPath;
    try {
      const size = statSync(path).size;
      const start = Math.max(0, size - CHANNEL_TAIL_BYTES);
      const fd = openSync(path, "r");
      let buf: Buffer;
      try {
        buf = Buffer.alloc(size - start);
        readSync(fd, buf, 0, buf.length, start);
      } finally { closeSync(fd); }
      // A mid-line start would yield one unparseable fragment; `channelActivity` skips it.
      const lines = buf.toString("utf-8").split("\n");
      return channelActivity(lines, { fileAgeMs: this.fileAgeMs(path, now), micOnly });
    } catch {
      return undefined;
    }
  }

  /** Age of a file by mtime, or null when it does not exist / cannot be read. */
  private fileAgeMs(path: string | undefined, now: number): number | null {
    if (!path || !existsSync(path)) return null;
    try { return Math.max(0, Math.round(now - statSync(path).mtimeMs)); } catch { return null; }
  }

  /** Is the capture process for this runtime dir alive? Same probe as `stop`/`poll`. */
  private captureAlive(): boolean {
    const dir = this.opts.runtimeDir;
    if (!dir) return false;
    const pidFile = join(dir, "capture.pid");
    if (!existsSync(pidFile)) return false;
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (!Number.isFinite(pid)) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  /** Send a heartbeat to every connected client — liveness is zone-independent. */
  private broadcastHeartbeat(hb: Heartbeat): void {
    const payload = `data: ${JSON.stringify(hb)}\n\n`;
    for (const c of this.clients) c.res.write(payload);
  }

  /** Broadcast a pending marker, gated by zone and the window's category appetite (D4). */
  private broadcastPending(p: Pending): void {
    this.emit({ kind: "pending", msg: p as unknown as Record<string, unknown> });
  }

  // ---- predictive staging (predictive-staging) ----
  //
  // A prediction is a guess, and the wall carries authority, so a guess is prepared in
  // the private zone and NEVER published autonomously. The zone model already keeps a
  // `private` staged event off every public client; promotion is the only path to the
  // public wall, and it is operator/rule-triggered, cheap (a zone-lift of the existing
  // draw), and — into a public zone — subject to the same redaction as any event.

  private stageKey(cat: string, visual: string): string {
    return JSON.stringify([cat, visual]);
  }

  /**
   * Promote a staged private visual into a target zone. Refused unless the visual is a
   * LIVE staged prediction (present in the registry and not expired), so a stale or
   * never-staged visual can never be lifted. The lift re-runs the already-prepared visual
   * through `ingest` as one reset delta in the target zone — no re-draw — so redaction,
   * public-slice accumulation, broadcast, and the show all happen on identical terms.
   */
  private promote(p: Promote): void {
    const key = this.stageKey(p.category, p.visual);
    const g = this.graphs.get(p.category)?.get(p.visual);
    if (!g || !g.private.present) {
      console.warn(`[set-copilot] wall: refusing promote — nothing staged for "${p.category}"/"${p.visual}"`);
      return;
    }
    if (!this.staged.has(key)) {
      console.warn(`[set-copilot] wall: refusing promote — "${p.visual}" is not a live staged prediction (expired or never staged)`);
      return;
    }
    this.staged.delete(key); // promoted → no longer staged or expirable
    const zone: Zone = p.zone ?? "public";
    this.ingest({
      category: p.category,
      zone,
      visual: p.visual,
      graph: { op: "reset", nodes: [...g.private.nodes.values()], edges: g.private.edges },
    });
  }

  /** Release staged predictions past their ttl: drop them and mark the private view (D4). */
  private sweepStaged(now: number): void {
    const ttl = this.opts.stagingTtlMs ?? 120_000;
    if (ttl <= 0) return;
    for (const [key, at] of this.staged) {
      if (now - at < ttl) continue;
      this.staged.delete(key);
      const [category, visual] = JSON.parse(key) as [string, string];
      this.broadcastStageExpired({ kind: "stage-expired", category, visual });
    }
  }

  /** Tell the private view a staged prediction expired — never a public client (D4). */
  private broadcastStageExpired(m: StageExpired): void {
    this.emit({ kind: "stage-expired", msg: m as unknown as Record<string, unknown> });
  }

  // ---- runtime layout switch (wall-chat-mirror) ----
  //
  // Reshapes ONE window's geometry while the wall is live — no restart. Geometry only
  // (display-layout MODIFIED): the target route's boxes keep their behavior, pacing, and
  // subscriptions; only the grid they sit in changes. An unknown route or layout is
  // dropped with a warning, never blanking a window — the same fail-safe posture as an
  // unknown layout at resolve time.

  private switchLayout(cmd: LayoutSwitch): void {
    if (!this.windowFor(cmd.route)) {
      console.warn(`[set-copilot] wall: dropping layout switch — no window at route "${cmd.route}"`);
      return;
    }
    const layout = this.opts.layouts?.find((l) => l.id === cmd.layout);
    if (!layout) {
      console.warn(`[set-copilot] wall: dropping layout switch — unknown layout "${cmd.layout}" (route "${cmd.route}")`);
      return;
    }
    // Record the override so a client that connects AFTER the switch bootstraps into the
    // new geometry, then push the full layout to every live client on this route — the
    // geometry rides the message, so the client re-derives its grid with no extra fetch.
    this.layoutOverrides.set(cmd.route, layout);
    this.emit({ kind: "layout", msg: { kind: "layout", route: cmd.route, layout } });
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
    // The heartbeat is server-authoritative like `show` (wall-liveness): a source that
    // injects one via the canonical log could fake liveness, so it is dropped here.
    if (isHeartbeat(msg)) {
      console.warn("[set-copilot] wall: dropping externally-supplied heartbeat — heartbeat is server-only");
      return;
    }
    // A pending marker (wall-pending-indicator) broadcasts through the zone gate like an
    // event, but is NOT accumulated: it is transient placeholder feedback, not replayable
    // state, so a late join never reconstructs a stale spinner (D3). Re-validated here
    // because the JSONL tailer reaches ingest without passing through `wall-emit`.
    if (isPending(msg)) {
      const p = normalizePending(msg);
      if (!p.ok) {
        console.warn(`[set-copilot] wall: dropping invalid pending (${p.reason})`);
        return;
      }
      this.broadcastPending(p.pending);
      return;
    }
    // A stage-expired marker is server-authoritative like `show`/`heartbeat`: the server
    // decides when a staged prediction dies, so an injected one is dropped.
    if (isStageExpired(msg)) {
      console.warn("[set-copilot] wall: dropping externally-supplied stage-expired — it is server-only");
      return;
    }
    // A runtime layout switch (wall-chat-mirror) reshapes one window's geometry. It is
    // operator/skill-triggered like `promote` (reaches ingest through the canonical log),
    // carries no content, and is applied only if the named layout is in the registry.
    if (isLayoutSwitch(msg)) {
      this.switchLayout(msg);
      return;
    }
    // A promote lifts an already-staged private visual into a target zone (predictive-
    // staging). It carries no payload; the server re-runs the staged visual through this
    // same funnel so redaction and broadcast happen exactly as for any event.
    if (isPromote(msg)) {
      const p = normalizePromote(msg);
      if (!p.ok) {
        console.warn(`[set-copilot] wall: dropping invalid promote (${p.reason})`);
        return;
      }
      this.promote(p.promote);
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

    // Register a predictive staged visual for the promote gate + expiry (predictive-
    // staging). Only a private graph carrying `staged:true` enters the registry; the zone
    // model already keeps it off every public client, and it reaches the public wall only
    // through an explicit promote.
    if (msg.staged && msg.graph && msg.visual && reachesPrivate(msg.zone)) {
      this.staged.set(this.stageKey(msg.category, msg.visual), Date.now());
    }

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

  /**
   * Is a live audience looking at this client's window?
   *
   * A READ of the window's declaration — never an inference (wall-public-surface D1).
   * This one predicate is the pivot for every public-zone protection: which redacted
   * variant `broadcastEvent` writes, which accumulation slice `replay` reads, whether a
   * `stage-expired` marker is suppressed, and how a `show` is zoned.
   *
   * It used to be `!client.zones.includes("private")`, which answered "is an audience
   * looking?" by negating "what may this window display?". Those are different questions,
   * and conflating them was a leak: an operator who widened the public wall's zones to
   * show more — the natural way to do what the field asked for — silently turned redaction
   * OFF in front of a room, with no warning.
   *
   * DO NOT re-derive this from `zones` for convenience. The fail-closed default is
   * unit-tested by name precisely so that re-inferring breaks a named test.
   *
   * Written as "anything that is not explicitly `operator`" rather than "is `public`", so
   * the fail-closed reading holds even for a `ResolvedWindow` that reached the server
   * without going through `resolveAudience` — a hand-built window, a future caller, a
   * partially-applied upgrade. `=== "public"` would make an unset field mean "not public
   * → no redaction", which is the original defect wearing a new field name.
   */
  private isPublicClient(client: Client): boolean {
    return client.audience !== "operator";
  }

  /**
   * What this client should receive for one retained broadcast, or null if the gates
   * exclude it.
   *
   * THE single place the per-client gates live. Live broadcast and resume both go through
   * it, so resume cannot drift into a second, subtly different delivery path — the risk
   * the design named as this change's highest-stakes part.
   */
  private payloadFor(entry: TailEntry, client: Client): string | null {
    const isPub = this.isPublicClient(client);
    if (entry.kind === "event") {
      const ev = isPub ? entry.variants!.public : entry.variants!.private;
      if (!ev) return null; // withheld from the public zone
      // A public surface NEVER receives a private-zone event, whatever its zone filter
      // says (wall-public-surface D3). Enforced here rather than left to the zone filter,
      // because leaving it to the filter is exactly what broke: `zone: "private"` has to
      // be the one gate no configuration can route around. Redaction is a shape-matcher,
      // not a classifier, and it is not what stands between an internal detail and a room.
      if (isPub && ev.zone === "private") return null;
      // A display event must clear BOTH gates: its zone reaches the window, and the
      // window actually has a box for its category. The category gate matters even
      // apart from redaction: a `both` event no box asked for would otherwise sit on
      // a window's wire unrendered — data on the socket is data delivered.
      if (!zoneMatches(ev.zone, client.zones)) return null;
      if (!client.cats.has(ev.category)) return null;
      return `data: ${JSON.stringify(ev)}\n\n`;
    }
    const m = entry.msg!;
    // The same D3 gate for the server-authored messages. A `show` carries a visual id
    // (free producer text, zoned for exactly that reason) and a `pending` carries a
    // label; both are content. Gating only the display event would leave the zone
    // routable around on precisely the two messages that name what is being drawn.
    if (isPub && m.zone === "private") return null;
    if (entry.kind === "show") {
      const zone = m.zone as Zone | undefined;
      if (zone && !zoneMatches(zone, client.zones)) return null;
      return `data: ${JSON.stringify(m)}\n\n`;
    }
    if (entry.kind === "pending") {
      if (!zoneMatches(m.zone as Zone, client.zones)) return null;
      if (!client.cats.has(m.category as string)) return null;
      return `data: ${JSON.stringify(m)}\n\n`;
    }
    if (entry.kind === "stage-expired") {
      if (isPub) return null; // a stage-expired marker is private-only
      if (!client.cats.has(m.category as string)) return null;
      return `data: ${JSON.stringify(m)}\n\n`;
    }
    // layout: targets one route
    if (m.route !== client.route) return null;
    return `data: ${JSON.stringify(m)}\n\n`;
  }

  /**
   * Assign the next resume id, retain the broadcast, and deliver it to every client the
   * gates admit.
   *
   * Heartbeats deliberately do NOT come through here: they arrive once a second, would
   * evict the tail within seconds, and carry nothing worth resuming. Leaving them without
   * an id also means a client's `Last-Event-ID` stays pinned to the last real broadcast.
   */
  private emit(entry: Omit<TailEntry, "seq">): void {
    const full: TailEntry = { ...entry, seq: ++this.seq };
    this.tail.push(full);
    if (this.tail.length > this.tailN) this.tail.shift();
    for (const c of this.clients) {
      const payload = this.payloadFor(full, c);
      if (payload) c.res.write(`id: ${this.runId}:${full.seq}\n${payload}`);
    }
  }

  /** Broadcast a display event's zone-appropriate variant to each client. */
  private broadcastEvent(variants: EventVariants): void {
    this.emit({ kind: "event", variants });
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
    this.emit({ kind: "show", msg: show as unknown as Record<string, unknown> });
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

    // Send one immediate heartbeat so a freshly-connected client's status strip is
    // populated between connect and the first timer tick (wall-liveness task 2.5).
    if (this.opts.runtimeDir) {
      client.res.write(`data: ${JSON.stringify(this.computeHeartbeat(Date.now()))}\n\n`);
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
      // `Last-Event-ID` is the browser's own reconnect cursor — it re-presents the last
      // `id:` it saw with no client code involved. The query parameter is the escape hatch
      // for a non-browser client (and for the tests).
      const header = req.headers["last-event-id"];
      const lastEventId = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get("lastEventId") ?? undefined;
      this.handleSse(url, res, lastEventId);
      return;
    }
    if (path === "/api/bootstrap") {
      const route = url.searchParams.get("route") ?? "/";
      const win = this.windowFor(route);
      if (!win) return this.notFound(res);
      // Apply an active runtime layout override (wall-chat-mirror) so a client that
      // connects after a switch bootstraps into the new geometry. Boxes are unchanged.
      const override = this.layoutOverrides.get(route);
      const shaped = override ? { ...win, layout: override } : win;
      // The heartbeat interval is advertised so the client can derive its
      // stream-liveness threshold from it rather than hardcode a second copy
      // (wall-stream-recovery D4). Zero means this wall sends no heartbeats at all (no
      // runtime dir to watch), which is not the same as a dead stream — the client must
      // be able to tell those apart or it would report every fake-feed wall as broken.
      const heartbeatMs = this.opts.runtimeDir ? (this.opts.heartbeatMs ?? 1000) : 0;
      return this.json(res, {
        window: publicWindowShape(shaped),
        categories: this.opts.registry.list(),
        heartbeatMs,
      });
    }
    if (path === "/media") {
      return this.serveMedia(res, url.searchParams.get("src") ?? "");
    }
    // A declared window route serves the static shell; other paths are assets.
    if (this.windowFor(path)) return this.serveFile(res, join(this.opts.publicDir, "index.html"));
    this.serveFile(res, join(this.opts.publicDir, "." + path));
  }

  /**
   * Can we give this client exactly what it missed?
   *
   * Only when the id names THIS run and the tail still reaches back that far. Anything
   * else — another run, an evicted position, a malformed or absent header — is
   * unsatisfiable, and the honest answer is a full replay rather than a silent gap.
   */
  private resumeFrom(lastEventId: string | undefined): TailEntry[] | null {
    if (!lastEventId) return null;
    const sep = lastEventId.lastIndexOf(":");
    if (sep < 0) return null;
    if (lastEventId.slice(0, sep) !== this.runId) return null; // a different server run
    const from = Number(lastEventId.slice(sep + 1));
    if (!Number.isFinite(from)) return null;
    if (from >= this.seq) return []; // already current — nothing missed
    // Retained back far enough? The oldest entry must be no newer than the next one owed.
    if (!this.tail.length || this.tail[0].seq > from + 1) return null;
    return this.tail.filter((e) => e.seq > from);
  }

  private handleSse(url: URL, res: ServerResponse, lastEventId?: string): void {
    const win = this.windowFor(url.searchParams.get("route") ?? "/");
    if (!win) return this.notFound(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 2000\n\n"); // native auto-reconnect interval
    const cats = windowCats(win.boxes);
    const client: Client = { res, route: win.route, zones: win.zones, audience: win.audience, cats };
    this.clients.add(client);

    const missed = this.resumeFrom(lastEventId);
    if (missed) {
      // Resume: only the span this client did not get, through the SAME gates the live
      // broadcast used. Its display ends up identical to a client that never dropped.
      for (const entry of missed) {
        const payload = this.payloadFor(entry, client);
        if (payload) res.write(`id: ${this.runId}:${entry.seq}\n${payload}`);
      }
      if (this.opts.runtimeDir) {
        res.write(`data: ${JSON.stringify(this.computeHeartbeat(Date.now()))}\n\n`);
      }
    } else {
      // Fallback (D2): a full state replay, announced as such. The client REBUILDS its
      // lanes from it rather than appending, because a full replay legitimately repeats
      // what the client may still be showing. Announcing it is what keeps the branch
      // honest — it is the one most likely to be optimized away later.
      res.write(`data: ${JSON.stringify({ kind: "replay", mode: "full" })}\n\n`);
      this.replay(client);
    }
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
