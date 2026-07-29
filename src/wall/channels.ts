/**
 * Per-channel activity, derived from the transcript (wall-viewport-and-activity D5).
 *
 * `wall-liveness`'s load-bearing invariant is that the party whose aliveness is in question
 * cannot be the source of the aliveness signal — which is why the heartbeat is computed by
 * the server from the runtime dir rather than emitted by the copilot. Splitting it per
 * channel must not weaken that: the `speaker` tag is already on every transcript line, so
 * this is a *grouping* of the existing derivation, not a new source.
 *
 * Pure and file-free on purpose: `server.ts` does the reading, this does the deciding, and
 * the deciding is what the tests can reach.
 *
 * ## Why the ages are relative to the file, not to the clock
 *
 * A transcript line's `ts` is milliseconds since **capture start**, not an epoch. The only
 * wall-clock anchor available without parsing the capture's own start time is the file's
 * mtime — which is exactly what `lastHeardMsAgo` already uses. So the newest line in the
 * file is taken to be `fileAgeMs` old, and every channel's age is that plus how far behind
 * the newest line that channel's own newest line is. Both halves come from the same two
 * facts the existing heartbeat already trusts; nothing new is being believed.
 */

import type { ChannelActivity } from "./types.js";

export interface ChannelActivitySet {
  mic: ChannelActivity;
  system: ChannelActivity;
}

export interface ChannelInputs {
  /** Age in ms of the transcript file itself (its mtime), or null if there is no file. */
  fileAgeMs: number | null;
  /** True when this capture has no system channel (`--mic-only` / dictation). */
  micOnly: boolean;
}

/** The newest `ts` overall and per speaker, from raw JSONL lines. */
interface Newest {
  all: number | null;
  mic: number | null;
  system: number | null;
}

function newestTimestamps(lines: string[]): Newest {
  const out: Newest = { all: null, mic: null, system: null };
  for (const line of lines) {
    if (!line) continue;
    let o: { ts?: unknown; speaker?: unknown; type?: unknown };
    try { o = JSON.parse(line) as typeof o; } catch { continue; }
    // A `silence` event is not speech on a channel; counting it would report activity on
    // whichever channel happened to be tagged, which is the opposite of what it means.
    if (typeof o.type === "string" && o.type !== "line") continue;
    const ts = typeof o.ts === "number" && Number.isFinite(o.ts) ? o.ts : null;
    if (ts === null) continue;
    if (out.all === null || ts > out.all) out.all = ts;
    const ch = o.speaker === "mic" || o.speaker === "system" ? o.speaker : null;
    if (ch && (out[ch] === null || ts > (out[ch] as number))) out[ch] = ts;
  }
  return out;
}

/**
 * Decide each channel's activity from the transcript's lines.
 *
 * A channel that exists but has said nothing yet reports `present: true, lastHeardMsAgo:
 * null` — "captured, nothing heard". A channel that is not part of this capture reports
 * `present: false`. Those are different displays, and conflating them is the specific
 * failure the spec calls out.
 */
export function channelActivity(lines: string[], inputs: ChannelInputs): ChannelActivitySet {
  const newest = newestTimestamps(lines);
  const ageOf = (ts: number | null): number | null => {
    if (ts === null || inputs.fileAgeMs === null || newest.all === null) return null;
    return Math.max(0, Math.round(inputs.fileAgeMs + (newest.all - ts)));
  };
  return {
    mic: { present: true, lastHeardMsAgo: ageOf(newest.mic) },
    system: inputs.micOnly
      ? { present: false, lastHeardMsAgo: null }
      : { present: true, lastHeardMsAgo: ageOf(newest.system) },
  };
}
