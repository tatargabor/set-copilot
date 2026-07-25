/**
 * `wall-emit` — the seam a producer uses to push a display event onto the wall.
 * The producer is a FORK of the main session (fork-wall-producer D1): it inherits
 * the chat's context — and with it the grounding — draws its slot, emits here, and
 * exits. This is its hand.
 *
 * It appends a byte-compatible `DisplayEvent` to `<runtimeDir>/wall-events.jsonl`
 * — the same JSONL append-and-tail seam the fake-feed targets — so the display
 * core, SSE, director, and client render are untouched.
 *
 * Validation mirrors the `detect.*` philosophy: a malformed event is dropped with
 * a reason, never crashing the caller. A producer can fire-and-forget.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { CopilotConfig } from "../config.js";
import { PAYLOAD_KEYS, type DisplayEvent, type LayoutSwitch, type PayloadKey, type Pending, type Promote, type Zone } from "./types.js";

/** The canonical events log a producer appends to (kept in sync with index.ts). */
export function wallEventsFile(runtimeDir: string): string {
  return join(runtimeDir, "wall-events.jsonl");
}

const ZONES: Zone[] = ["private", "public", "both"];

export type NormalizeResult =
  | { ok: true; event: DisplayEvent }
  | { ok: false; reason: string };

/**
 * Shape-check a `graph` payload. Deliberately minimal — the renderer tolerates extra
 * keys and free-form node fields — but `op` decides whether the client starts a fresh
 * visual or appends, so a payload without it would be silently unrenderable. Anything
 * that lands in the canonical log gets replayed forever, so it is checked on the way in.
 */
function badGraph(graph: unknown): string | null {
  if (typeof graph !== "object" || graph === null || Array.isArray(graph)) {
    return `graph must be an object, got ${JSON.stringify(graph)}`;
  }
  const op = (graph as { op?: unknown }).op;
  if (op !== "add" && op !== "reset") {
    return `graph.op must be "add" or "reset", got ${JSON.stringify(op)}`;
  }
  for (const key of ["nodes", "edges"] as const) {
    const v = (graph as Record<string, unknown>)[key];
    if (v !== undefined && !Array.isArray(v)) return `graph.${key} must be an array if present`;
  }
  return null;
}

/** Shape-check a `chart` payload — `data` drives the whole render, so it must be an array. */
function badChart(chart: unknown): string | null {
  if (typeof chart !== "object" || chart === null || Array.isArray(chart)) {
    return `chart must be an object, got ${JSON.stringify(chart)}`;
  }
  const c = chart as Record<string, unknown>;
  if (c.type !== "bar") return `chart.type must be "bar", got ${JSON.stringify(c.type)}`;
  if (!Array.isArray(c.data)) return "chart.data must be an array";
  return null;
}

/** An absolute http(s) URL. Other schemes (file:, data:, javascript:) are not sources we serve. */
function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Does `p` resolve inside `root`? Used to keep an `image` source from escaping the
 * project. `relative()` rather than `startsWith()` because a sibling directory
 * sharing a name prefix (`/proj-secrets` next to `/proj`) passes a prefix test.
 */
function insideRoot(p: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(root, p));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Shape-check an `image` payload. Validated here, on the way in, rather than at
 * render time (design D4): a bad source that is broadcast first fails on a live
 * display, and the traversal check has to happen server-side anyway because the
 * server is what serves the file.
 */
function badImage(image: unknown, projectRoot?: string): string | null {
  if (typeof image !== "object" || image === null || Array.isArray(image)) {
    return `image must be an object, got ${JSON.stringify(image)}`;
  }
  const src = (image as { src?: unknown }).src;
  if (typeof src !== "string" || !src.trim()) return "image.src must be a non-empty string";
  if (isHttpUrl(src)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) {
    return `image.src must be an http(s) URL or an in-project path, got ${JSON.stringify(src)}`;
  }
  if (!projectRoot) return "image.src is a path but no project root is available to resolve it against";
  if (isAbsolute(src) || !insideRoot(src, projectRoot)) {
    return `image.src must resolve inside the project root, got ${JSON.stringify(src)}`;
  }
  return null;
}

/** Shape-check a `webpage` payload — an absolute http(s) URL, nothing else. */
function badWebpage(webpage: unknown): string | null {
  if (typeof webpage !== "object" || webpage === null || Array.isArray(webpage)) {
    return `webpage must be an object, got ${JSON.stringify(webpage)}`;
  }
  const url = (webpage as { url?: unknown }).url;
  if (typeof url !== "string" || !isHttpUrl(url)) {
    return `webpage.url must be an absolute http(s) URL, got ${JSON.stringify(url)}`;
  }
  return null;
}

/** Which payload keys an object actually carries (a null payload counts as absent). */
function payloadsOn(o: Record<string, unknown>): PayloadKey[] {
  return PAYLOAD_KEYS.filter((k) => o[k] !== undefined && o[k] !== null);
}

export interface NormalizeOptions {
  /** Needed to resolve (and confine) a local `image.src`. */
  projectRoot?: string;
}

export function normalizeEvent(raw: unknown, opts: NormalizeOptions = {}): NormalizeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not an object" };
  }
  const o = raw as Record<string, unknown>;

  if ((o as { kind?: unknown }).kind === "show") {
    // ShowCommands are server-authoritative (the director emits them); a producer
    // must never inject one or it would desync the walls.
    return { ok: false, reason: "show commands are server-only, not producer output" };
  }

  const category = o.category;
  if (typeof category !== "string" || !category.trim()) {
    return { ok: false, reason: "missing/empty category" };
  }

  let zone: Zone = "both";
  if (o.zone !== undefined) {
    if (typeof o.zone !== "string" || !ZONES.includes(o.zone as Zone)) {
      return { ok: false, reason: `bad zone ${JSON.stringify(o.zone)} (expected private|public|both)` };
    }
    zone = o.zone as Zone;
  }

  // Exactly one payload (design D3). The renderer dispatches on the payload, so
  // two of them is genuinely ambiguous — it would render one and silently discard
  // the other — and this is stricter than the previous "at least one" check on
  // purpose, while there is still only one producer to migrate.
  const payloads = payloadsOn(o);
  if (payloads.length === 0) {
    return { ok: false, reason: `no payload (need exactly one of ${PAYLOAD_KEYS.join(", ")})` };
  }
  if (payloads.length > 1) {
    return { ok: false, reason: `exactly one payload allowed, got ${payloads.join(" + ")}` };
  }
  const payload = payloads[0];
  if (payload === "text" && typeof o.text !== "string") {
    return { ok: false, reason: `text must be a string, got ${JSON.stringify(o.text)}` };
  }

  const bad =
    payload === "graph" ? badGraph(o.graph)
    : payload === "chart" ? badChart(o.chart)
    : payload === "image" ? badImage(o.image, opts.projectRoot)
    : payload === "webpage" ? badWebpage(o.webpage)
    : null;
  if (bad) return { ok: false, reason: bad };

  // A staged prediction MUST be private (predictive-staging D1). The zone model is the
  // whole guarantee that a guess never publishes autonomously, so `staged:true` on a
  // `both`/`public` event is a contradiction — a single wrong zone character would else
  // publish a prediction with no server-side backstop. Reject it loudly, fail-closed,
  // rather than silently stripping the flag (which would still publish the content).
  if (o.staged === true && zone !== "private") {
    return { ok: false, reason: `staged predictions must be zone:"private", got ${JSON.stringify(zone)}` };
  }

  const event: DisplayEvent = { category: category.trim(), zone };
  if (o.speaker === "mic" || o.speaker === "system") event.speaker = o.speaker;
  if (o.priority === "immediate") event.priority = "immediate";
  if (typeof o.visual === "string") event.visual = o.visual;
  if (o.staged === true) event.staged = true; // predictive-staging marker (server-tracked)
  switch (payload) {
    case "text": event.text = o.text as string; break;
    case "graph": event.graph = o.graph as DisplayEvent["graph"]; break;
    case "chart": event.chart = o.chart as DisplayEvent["chart"]; break;
    case "image": event.image = o.image as DisplayEvent["image"]; break;
    case "webpage": event.webpage = o.webpage as DisplayEvent["webpage"]; break;
  }
  return { ok: true, event };
}

/** Default lifetime of a pending placeholder before the client releases it (D3). */
export const DEFAULT_PENDING_TTL_MS = 20_000;

export type NormalizePendingResult =
  | { ok: true; pending: Pending }
  | { ok: false; reason: string };

/**
 * Shape-check a `pending` marker (wall-pending-indicator D3/D4). Unlike a display
 * event it carries NO payload — just a category to target and a one-line label — and
 * it defaults to `zone: "private"`, because a placeholder is operator feedback and a
 * `both`/`public` "working…" caption would otherwise land on an audience wall. `ttlMs`
 * defaults so a producer that crashes mid-draw cannot strand a permanent spinner.
 */
export function normalizePending(raw: unknown): NormalizePendingResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not an object" };
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "pending") return { ok: false, reason: "not a pending marker" };

  const category = o.category;
  if (typeof category !== "string" || !category.trim()) {
    return { ok: false, reason: "missing/empty category" };
  }
  const label = o.label;
  if (typeof label !== "string" || !label.trim()) {
    return { ok: false, reason: "pending requires a non-empty label" };
  }

  let zone: Zone = "private"; // operator feedback by default (D4)
  if (o.zone !== undefined) {
    if (typeof o.zone !== "string" || !ZONES.includes(o.zone as Zone)) {
      return { ok: false, reason: `bad zone ${JSON.stringify(o.zone)} (expected private|public|both)` };
    }
    zone = o.zone as Zone;
  }

  let ttlMs = DEFAULT_PENDING_TTL_MS;
  if (o.ttlMs !== undefined) {
    if (typeof o.ttlMs !== "number" || !(o.ttlMs > 0)) {
      return { ok: false, reason: `ttlMs must be a positive number, got ${JSON.stringify(o.ttlMs)}` };
    }
    ttlMs = Math.floor(o.ttlMs);
  }

  return { ok: true, pending: { kind: "pending", category: category.trim(), zone, label: label.trim(), ttlMs } };
}

export type NormalizePromoteResult =
  | { ok: true; promote: Promote }
  | { ok: false; reason: string };

/**
 * Shape-check a `promote` command (predictive-staging D3). It lifts an existing staged
 * visual by (category, visual) into a target zone — default `public` — so it carries no
 * payload. The server enforces the gate (the visual must be staged and not expired) and
 * re-runs the lift through ingest so redaction applies; this only validates the request.
 */
export function normalizePromote(raw: unknown): NormalizePromoteResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not an object" };
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "promote") return { ok: false, reason: "not a promote command" };

  const category = o.category;
  if (typeof category !== "string" || !category.trim()) {
    return { ok: false, reason: "missing/empty category" };
  }
  const visual = o.visual;
  if (typeof visual !== "string" || !visual.trim()) {
    return { ok: false, reason: "promote requires the staged visual id" };
  }

  let zone: Zone = "public"; // publish target by default
  if (o.zone !== undefined) {
    if (typeof o.zone !== "string" || !ZONES.includes(o.zone as Zone)) {
      return { ok: false, reason: `bad zone ${JSON.stringify(o.zone)} (expected private|public|both)` };
    }
    zone = o.zone as Zone;
  }

  return { ok: true, promote: { kind: "promote", category: category.trim(), visual: visual.trim(), zone } };
}

export type NormalizeLayoutResult =
  | { ok: true; layout: LayoutSwitch }
  | { ok: false; reason: string };

/**
 * Shape-check a `layout` switch (wall-chat-mirror). It reshapes a window's geometry at
 * runtime and carries no payload — just the target route and the layout id to switch
 * to. The id is validated against the registry SERVER-side (only the server holds the
 * layouts), so here we only check the request is well-formed.
 */
export function normalizeLayoutSwitch(raw: unknown): NormalizeLayoutResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not an object" };
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "layout") return { ok: false, reason: "not a layout switch" };
  const route = o.route;
  if (typeof route !== "string" || !route.trim()) {
    return { ok: false, reason: "layout switch requires a non-empty route" };
  }
  const layout = o.layout;
  if (typeof layout !== "string" || !layout.trim()) {
    return { ok: false, reason: "layout switch requires a non-empty layout id" };
  }
  return { ok: true, layout: { kind: "layout", route: route.trim(), layout: layout.trim() } };
}

export interface EmitResult {
  emitted: number;
  dropped: { reason: string }[];
}

/**
 * Append one or more events to the wall's canonical log. Accepts a single event
 * object or an array; each is validated independently, bad ones dropped.
 *
 * The runtime dir is created if missing: only `capture` creates it today, but a
 * producer may legitimately emit with no capture running (a wall driven purely by
 * the session), and an uncaught ENOENT here would break the "never crash the
 * caller" promise above. A write that still fails is reported as a dropped batch
 * rather than thrown, for the same reason.
 */
export function emitWallEvents(cfg: CopilotConfig, raw: unknown): EmitResult {
  const items = Array.isArray(raw) ? raw : [raw];
  const file = wallEventsFile(cfg.runtimeDir);
  const result: EmitResult = { emitted: 0, dropped: [] };
  let batch = "";
  for (const item of items) {
    // A `pending` marker (wall-pending-indicator) takes the payload-free path; a
    // `heartbeat` is server-only and never valid from a producer (drop it, like `show`).
    const kind = (item as { kind?: unknown } | null)?.kind;
    if (kind === "heartbeat" || kind === "stage-expired") {
      result.dropped.push({ reason: `${kind} is server-only, not producer output` });
      continue;
    }
    if (kind === "pending") {
      const p = normalizePending(item);
      if (!p.ok) {
        result.dropped.push({ reason: p.reason });
        continue;
      }
      batch += JSON.stringify(p.pending) + "\n";
      result.emitted++;
      continue;
    }
    if (kind === "promote") {
      const p = normalizePromote(item);
      if (!p.ok) {
        result.dropped.push({ reason: p.reason });
        continue;
      }
      batch += JSON.stringify(p.promote) + "\n";
      result.emitted++;
      continue;
    }
    if (kind === "layout") {
      // A runtime layout switch (wall-chat-mirror): operator/skill-triggered, same trust
      // class as `promote`. It reshapes a window's geometry; the server validates the
      // layout id against its registry before broadcasting.
      const l = normalizeLayoutSwitch(item);
      if (!l.ok) {
        result.dropped.push({ reason: l.reason });
        continue;
      }
      batch += JSON.stringify(l.layout) + "\n";
      result.emitted++;
      continue;
    }
    const norm = normalizeEvent(item, { projectRoot: cfg.projectRoot });
    if (!norm.ok) {
      result.dropped.push({ reason: norm.reason });
      continue;
    }
    batch += JSON.stringify(norm.event) + "\n";
    result.emitted++;
  }
  if (!batch) return result;

  try {
    mkdirSync(cfg.runtimeDir, { recursive: true });
    appendFileSync(file, batch);
  } catch (e) {
    // Report, never throw: the caller fires and forgets.
    const written = result.emitted;
    result.emitted = 0;
    result.dropped.push({ reason: `could not write ${file}: ${(e as Error).message} (${written} event(s) lost)` });
  }
  return result;
}
