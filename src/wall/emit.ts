/**
 * `wall-emit` — the seam the MAIN session uses to push a display event onto the
 * wall (design D9). The "producer" is the Opus session itself; this is its hand.
 *
 * It appends a byte-compatible `DisplayEvent` to `<runtimeDir>/wall-events.jsonl`
 * — the same JSONL append-and-tail seam the fake-feed and `wall-feed` target — so
 * the display core, SSE, director, and client render are untouched.
 *
 * Validation mirrors the `detect.*` philosophy: a malformed event is dropped with
 * a reason, never crashing the caller. The main session can fire-and-forget.
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";

import type { CopilotConfig } from "../config.js";
import type { DisplayEvent, Zone } from "./types.js";

/** The canonical events log a producer appends to (kept in sync with index.ts). */
export function wallEventsFile(runtimeDir: string): string {
  return join(runtimeDir, "wall-events.jsonl");
}

const ZONES: Zone[] = ["private", "public", "both"];

export type NormalizeResult =
  | { ok: true; event: DisplayEvent }
  | { ok: false; reason: string };

/**
 * Validate + normalize one raw object into a `DisplayEvent`. Permissive on shape
 * (a category may carry text, graph, chart, or several), strict on the two fields
 * routing depends on: a non-empty `category`, and a `zone` that defaults to "both".
 */
export function normalizeEvent(raw: unknown): NormalizeResult {
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

  const hasPayload =
    typeof o.text === "string" || (o.graph !== undefined && o.graph !== null) || (o.chart !== undefined && o.chart !== null);
  if (!hasPayload) {
    return { ok: false, reason: "no payload (need text, graph, or chart)" };
  }

  const event: DisplayEvent = { category: category.trim(), zone };
  if (typeof o.text === "string") event.text = o.text;
  if (o.speaker === "mic" || o.speaker === "system") event.speaker = o.speaker;
  if (o.priority === "immediate") event.priority = "immediate";
  if (typeof o.visual === "string") event.visual = o.visual;
  if (o.graph !== undefined && o.graph !== null) event.graph = o.graph as DisplayEvent["graph"];
  if (o.chart !== undefined && o.chart !== null) event.chart = o.chart as DisplayEvent["chart"];
  return { ok: true, event };
}

export interface EmitResult {
  emitted: number;
  dropped: { reason: string }[];
}

/**
 * Append one or more events to the wall's canonical log. Accepts a single event
 * object or an array; each is validated independently, bad ones dropped.
 */
export function emitWallEvents(cfg: CopilotConfig, raw: unknown): EmitResult {
  const items = Array.isArray(raw) ? raw : [raw];
  const file = wallEventsFile(cfg.runtimeDir);
  const result: EmitResult = { emitted: 0, dropped: [] };
  let batch = "";
  for (const item of items) {
    const norm = normalizeEvent(item);
    if (!norm.ok) {
      result.dropped.push({ reason: norm.reason });
      continue;
    }
    batch += JSON.stringify(norm.event) + "\n";
    result.emitted++;
  }
  if (batch) appendFileSync(file, batch);
  return result;
}
