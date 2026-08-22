/**
 * The scenario timeline — a scenario read as a document rather than a fixture.
 *
 * The operator's requirement, and the reason this exists: you have to be able to SEE
 * when the presenter says what. A scenario that can only be inspected as JSONL is a
 * scenario nobody reviews, and an unreviewed scenario quietly becomes a flattering
 * measuring stick.
 *
 * It is a *view*, never an input. The renderer takes the already-loaded scenario — the
 * same single parse the player and the scorer use — so a timeline cannot disagree with
 * what will actually be played. `timelineIsStale` exists for the one case the generated
 * file can still be wrong: somebody edited the script and did not regenerate. A stale
 * timeline is worse than none, because it is trusted.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  SCENARIO_FILES, entryTs, type PlantedMoment, type Scenario, type ScriptEntry,
} from "./replay-scenario.js";
import { stamp } from "./replay.js";

/** Marker line carrying the fingerprint the timeline was rendered from. */
const FINGERPRINT_MARK = "<!-- scenario-fingerprint:";

function momentLine(m: PlantedMoment): string {
  const within = m.withinMs ? ` _(within ${Math.round(m.withinMs / 1000)}s)_` : "";
  return `> **⟨planted: ${m.kind}⟩ \`${m.id}\`** — ${m.expect}${within}`;
}

/**
 * One entry, as a list item.
 *
 * A list, not bare lines: consecutive lines in Markdown collapse into a single flowing
 * paragraph, which is precisely the unreadable blob this document exists to avoid. The
 * list also survives being pasted into an issue, a chat, or the wall.
 */
function entryLine(entry: ScriptEntry): string {
  const at = stamp(entryTs(entry));
  if (entry.event) {
    const ev = entry.event;
    const dur = typeof ev.duration_ms === "number" ? ` (${Math.round(ev.duration_ms / 1000)}s)` : "";
    return `- \`${at}\` · _— ${ev.type}${dur} —_`;
  }
  const l = entry.line as { speaker: string; text: string };
  const who = l.speaker === "mic" ? "**előadó**" : "**hallgatóság**";
  return `- \`${at}\` · ${who}: ${l.text}`;
}

/**
 * Render a scenario as a readable document.
 *
 * Planted moments are placed at their `at`, immediately after the last entry that is not
 * later than they are — so a reviewer reads the trap where it springs, not in a separate
 * list they have to correlate by hand.
 */
export function renderTimeline(s: Scenario): string {
  const out: string[] = [];
  out.push(`# ${s.meta.name}`);
  out.push("");
  if (s.meta.description) out.push(s.meta.description, "");
  out.push(`${FINGERPRINT_MARK} ${s.fingerprint} -->`);
  out.push("");
  out.push(`- **Hossz:** ${stamp(s.durationMs)}`);
  out.push(`- **Bejegyzések:** ${s.script.length}`);
  out.push(`- **Beültetett pillanatok:** ${s.moments.length}`);
  if (s.meta.sourceMaterial) out.push(`- **Forrásanyag:** ${s.meta.sourceMaterial}`);
  out.push(`- **Ujjlenyomat:** \`${s.fingerprint}\``);
  out.push("");
  out.push("---");
  out.push("");

  // Moments in scenario order; each is emitted after the last entry at or before its time.
  const pending = [...s.moments].sort((a, b) => a.at - b.at);
  let mi = 0;
  let section: string | undefined;

  for (const entry of s.script) {
    const at = entryTs(entry);
    if (entry.section && entry.section !== section) {
      section = entry.section;
      out.push("");
      out.push(`## ${section}`);
      out.push("");
    }
    out.push(entryLine(entry));
    while (mi < pending.length && pending[mi].at <= at) {
      out.push("");
      out.push(momentLine(pending[mi]));
      out.push("");
      mi++;
    }
  }
  // Anything planted past the last entry still has to be visible, not silently dropped.
  while (mi < pending.length) {
    out.push("");
    out.push(momentLine(pending[mi]));
    mi++;
  }

  out.push("");
  return out.join("\n");
}

/** The fingerprint a rendered timeline records, or null if it carries none. */
export function fingerprintOf(timeline: string): string | null {
  const line = timeline.split("\n").find((l) => l.startsWith(FINGERPRINT_MARK));
  if (!line) return null;
  return line.slice(FINGERPRINT_MARK.length).replace("-->", "").trim() || null;
}

/**
 * Is the timeline on disk out of date with the scenario?
 *
 * Compares fingerprints rather than re-rendering and diffing: the fingerprint covers the
 * script and the expectations, which is exactly what a timeline must reflect, and it does
 * not go stale on a cosmetic change to the renderer itself.
 */
export function timelineIsStale(s: Scenario, timeline: string | null): boolean {
  if (timeline === null) return true;
  return fingerprintOf(timeline) !== s.fingerprint;
}

/** Write the timeline next to the scenario. Returns its path. */
export function writeTimeline(s: Scenario): string {
  const path = join(s.dir, SCENARIO_FILES.timeline);
  writeFileSync(path, renderTimeline(s));
  return path;
}

/** Read the timeline on disk, or null when there is none. */
export function readTimeline(dir: string): string | null {
  const path = join(dir, SCENARIO_FILES.timeline);
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}
