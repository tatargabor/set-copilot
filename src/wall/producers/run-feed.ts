/**
 * Prototype runner: replay a transcript through the graph-worker and push the
 * resulting deltas to the wall's canonical events file (the JSONL append-and-tail
 * seam). This replaces the scripted fake-feed with a REAL model-driven feed —
 * the wall renders whatever the worker extracts, byte-compatible with the
 * fake-feed shape.
 *
 * It also proves the D3 constraints in practice: one structured Haiku call per
 * span, stateful accumulation (minimal deltas), direct-to-hub emission.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import type { CopilotConfig } from "../../config.js";
import { wallEventsPath } from "../index.js";
import { GraphWorker } from "./graph-worker.js";
import type { WireMessage } from "../types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the spoken text lines (mic/system) out of a transcript JSONL file. */
function transcriptLines(file: string): string[] {
  if (!existsSync(file)) throw new Error(`[wall-feed] transcript not found: ${file}`);
  const out: string[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n").filter(Boolean)) {
    try {
      const j = JSON.parse(line) as { text?: string };
      if (j.text && j.text.trim()) out.push(j.text.trim());
    } catch { /* skip non-JSON */ }
  }
  return out;
}

/** Group lines into spans of roughly `linesPerSpan`, so each model call sees a thought-unit. */
function toSpans(lines: string[], linesPerSpan: number): string[] {
  const spans: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerSpan) {
    spans.push(lines.slice(i, i + linesPerSpan).join(" "));
  }
  return spans;
}

export interface FeedOptions {
  transcript: string;
  model?: string;
  /** Lines of transcript per model call. */
  linesPerSpan?: number;
  /** Pause between spans (ms) so the wall builds visibly. */
  pauseMs?: number;
  /** Truncate the events file before starting (fresh wall). */
  reset?: boolean;
}

export async function runTranscriptFeed(cfg: CopilotConfig, opts: FeedOptions): Promise<void> {
  const eventsFile = wallEventsPath(cfg);
  if (opts.reset) writeFileSync(eventsFile, "");

  const emit = (msg: WireMessage): void => appendFileSync(eventsFile, JSON.stringify(msg) + "\n");

  const lines = transcriptLines(opts.transcript);
  const spans = toSpans(lines, opts.linesPerSpan ?? 5);
  const worker = new GraphWorker({ model: opts.model });

  console.log(`[wall-feed] ${lines.length} transcript lines → ${spans.length} spans → ${eventsFile}`);
  console.log(`[wall-feed] model: ${opts.model || "claude-haiku-4-5"} · this sends transcript content to the Anthropic API`);

  let span = 0;
  for (const text of spans) {
    span++;
    const t0 = Date.now();
    let events: WireMessage[] = [];
    try {
      events = await worker.process(text);
    } catch (err) {
      console.error(`[wall-feed] span ${span} failed: ${(err as Error).message}`);
    }
    const ms = Date.now() - t0;
    for (const e of events) emit(e);
    const added = events.flatMap((e) => ("graph" in e && e.graph?.nodes) || []).length;
    const charted = events.some((e) => "chart" in e);
    console.log(`[wall-feed] span ${span}/${spans.length} (${ms}ms): +${added} nodes${charted ? " +chart" : ""} · graph now ${worker.nodeCount} nodes`);
    if (opts.pauseMs) await sleep(opts.pauseMs);
  }
  console.log(`[wall-feed] done — ${worker.nodeCount} nodes on the wall`);
}
