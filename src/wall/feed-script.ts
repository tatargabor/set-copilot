/**
 * The scripted fake-feed (design D8) — one event source among possibly many,
 * proving the ingest seam without any microphone, Soniox, or LLM. It emits a
 * predefined timeline exercising every corner of the display model: scrolling
 * processed hints, a pinned immediate alert, private/public zones, a graph that
 * builds incrementally then resets to a new visual for the paced director to
 * swap between, and a data chart that updates.
 *
 * There is deliberately no raw transcript — the wall shows only processed
 * copilot output. Implemented as an `EventSource`, so the server treats it
 * exactly like a real out-of-process producer would be treated (task 3.4).
 */

import type { EventSource } from "./event-source.js";
import type { WireMessage } from "./types.js";

interface Beat {
  after: number; // ms after the previous beat
  msg: (loop: number) => WireMessage;
}

const TIMELINE: Beat[] = [
  { after: 300, msg: () => ({ category: "súgás", zone: "private", text: "💡 A capture birtokolja a runtime-dirt — egy PID, egy transcript." }) },
  { after: 300, msg: (n) => ({ category: "architektúra", zone: "both", visual: `v${n}a`, graph: { op: "reset" } }) },
  { after: 400, msg: (n) => ({ category: "architektúra", zone: "both", visual: `v${n}a`, graph: { op: "add", nodes: [{ id: "mic", label: "🎙 mic" }, { id: "capture", label: "capture" }], edges: [{ source: "mic", target: "capture" }] } }) },
  { after: 1400, msg: (n) => ({ category: "architektúra", zone: "both", visual: `v${n}a`, graph: { op: "add", nodes: [{ id: "transcript", label: "transcript.jsonl" }], edges: [{ source: "capture", target: "transcript" }] } }) },
  { after: 1300, msg: (n) => ({ category: "architektúra", zone: "both", visual: `v${n}a`, graph: { op: "add", nodes: [{ id: "poll", label: "poll" }, { id: "claude", label: "Claude session" }], edges: [{ source: "transcript", target: "poll" }, { source: "poll", target: "claude" }] } }) },
  { after: 900, msg: () => ({ category: "metrika", zone: "both", chart: { type: "bar", title: "Modul méret (LOC)", data: [{ label: "capture", value: 210 }, { label: "poll", value: 105 }, { label: "knowledge", value: 340 }, { label: "wall", value: 520 }] } }) },
  { after: 1400, msg: () => ({ category: "riasztás", zone: "private", priority: "immediate", text: "⚠ Ellentmondás: a második capture-t el kell utasítani, különben árván marad az első." }) },
  { after: 1600, msg: () => ({ category: "súgás", zone: "private", text: "💡 Váltás a knowledge pipeline-ra — a digest három artifactot ír." }) },
  { after: 300, msg: (n) => ({ category: "architektúra", zone: "both", visual: `v${n}b`, graph: { op: "reset" } }) },
  { after: 500, msg: (n) => ({ category: "architektúra", zone: "both", visual: `v${n}b`, graph: { op: "add", nodes: [{ id: "sources", label: "knowledge.sources" }, { id: "adapter", label: "adapter" }], edges: [{ source: "sources", target: "adapter" }] } }) },
  { after: 1400, msg: (n) => ({ category: "architektúra", zone: "both", visual: `v${n}b`, graph: { op: "add", nodes: [{ id: "index", label: "keyword-index" }, { id: "digest", label: "digest.md" }], edges: [{ source: "adapter", target: "index" }, { source: "adapter", target: "digest" }] } }) },
  { after: 900, msg: () => ({ category: "metrika", zone: "both", chart: { type: "bar", title: "Teszt-lefedettség (%)", unit: "%", data: [{ label: "config", value: 92 }, { label: "knowledge", value: 78 }, { label: "wall", value: 71 }, { label: "poll", value: 64 }] } }) },
  { after: 2200, msg: () => ({ category: "súgás", zone: "private", text: "💡 A capture az indexet olvassa; a digest a context.json-t és a digest.md-t is kiírja." }) },
];

export function fakeFeedSource(): EventSource {
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;

  const schedule = (onMessage: (m: WireMessage) => void, loop: number): void => {
    let acc = 0;
    for (const beat of TIMELINE) {
      acc += beat.after;
      timers.push(setTimeout(() => { if (!stopped) onMessage(beat.msg(loop)); }, acc));
    }
    // Loop with a fresh set of visual ids so the canvas keeps getting new topics.
    timers.push(setTimeout(() => { if (!stopped) schedule(onMessage, loop + 1); }, acc + 4000));
  };

  return {
    name: "fake-feed",
    start(onMessage) { schedule(onMessage, 1); },
    stop() { stopped = true; for (const t of timers) clearTimeout(t); },
  };
}
