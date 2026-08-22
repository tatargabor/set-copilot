import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CopilotConfig } from "./config.js";
import { captureAlive as runtimeDirHasLiveOwner } from "./runtime-dir.js";

/**
 * Is someone recording into this runtime dir right now?
 *
 * Deliberately not "is a capture running": a `set-copilot replay` owns the dir under
 * the same PID file, and the poll loop must not be able to tell the difference — that
 * indistinguishability is the whole basis of the replay harness.
 */
function captureAlive(cfg: CopilotConfig): boolean {
  return runtimeDirHasLiveOwner(cfg.runtimeDir);
}

/** Strip everything but letters/digits, in any script — an accent-blind compare would
 *  collapse non-Latin text to nothing and make every line look like a duplicate. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Filter transcript lines: drop empty/"..." lines and mic/system echo duplicates
 * (containment check, two lines deep). Keeps silence events verbatim.
 */
function filterLines(lines: string[]): string[] {
  const out: string[] = [];
  let p1 = "";
  let p2 = "";
  for (const line of lines) {
    // Non-speech events carry no "text" — pass them through instead of letting the
    // dedup below drop them. A reconnect marker in particular MUST reach the copilot:
    // it is the only signal that a stretch of the meeting may be missing.
    if (line.includes('"type":"silence"') || line.includes('"type":"reconnect"')) {
      out.push(line);
      continue;
    }
    const m = line.match(/"text":"((?:[^"\\]|\\.)*)"/);
    const s = normalize(m?.[1] ?? "");
    if (!s) continue;
    if ((p1 && (p1.includes(s) || s.includes(p1))) || (p2 && (p2.includes(s) || s.includes(p2)))) {
      p2 = p1;
      p1 = s;
      continue;
    }
    p2 = p1;
    p1 = s;
    out.push(line);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What one tick of the poll decides to do. */
export type PollAction =
  /** Stop waiting and hand over what is pending. */
  | { kind: "ready"; reason: "early" | "capture-gone" }
  /** The capture is gone and there is nothing left to hand over. */
  | { kind: "dead" }
  /** Nothing yet — wait another tick. */
  | { kind: "wait" };

/**
 * The poll's decision for one tick: given liveness, the file, and the offset, what now?
 *
 * Pure, and separate from the loop, so the one case that used to be wrong can be asserted
 * without processes or timers. The bug it exists to prevent: reporting a dead capture
 * BEFORE reading the transcript, which discarded every line written between the consumer's
 * previous poll and the capture's exit — the closing minutes of a meeting, where the
 * decisions are.
 */
export function pollDecision(alive: boolean, all: string[], last: number): PollAction {
  const unread = all.length > last ? filterLines(all.slice(last)) : [];

  if (!alive) {
    // Drain first. Death is reported on the NEXT poll, once there is genuinely nothing
    // left — a terminator that can be preceded by content in the same response would
    // force every consumer to re-check its parsing assumption.
    return unread.length > 0 ? { kind: "ready", reason: "capture-gone" } : { kind: "dead" };
  }

  const early =
    unread.some(
      (l) =>
        l.includes('"urgency":"high"') ||
        l.includes('"question":true') ||
        // Addressed by name: a direct instruction must not wait behind the
        // ambient silence gate. Safe because a transcript line is already a
        // complete sentence — the writer flushes on `. ? !`, so the silence
        // event is a second, redundant coherence check, worth keeping only
        // for ambient listening where the copilot infers rather than obeys.
        l.includes('"command":true'),
    ) ||
    (unread.some((l) => l.includes('"type":"silence"')) && unread.some((l) => l.includes('"speaker"')));

  return early ? { kind: "ready", reason: "early" } : { kind: "wait" };
}

/**
 * Long-poll the transcript. Blocks until a reaction-worthy event appears or
 * maxWaitSec elapses, then prints the accumulated (filtered) lines to stdout.
 *
 * Early return when the fresh batch contains an urgent line, a question, or a
 * silence event that closes a spoken thought unit.
 *
 * When the capture is gone, the remaining unread lines are handed over FIRST and
 * {"type":"capture-dead"} is emitted on the following poll, once there is nothing
 * left. The old order — notice first, read never — silently dropped everything said
 * between a consumer's last poll and the capture's exit.
 */
export async function runPoll(cfg: CopilotConfig, maxWaitSec = 60): Promise<void> {
  const file = cfg.transcriptOutput;
  const stateFile = join(cfg.runtimeDir, "poll-offset");
  // 250ms, not 2000: the tick is pure detection granularity added to every reaction,
  // and re-reading one small file eight times a second costs nothing next to the
  // seconds it saves. Measured: the old tick added up to 2s to every round.
  const tick = 250;

  let last = 0;
  if (existsSync(stateFile)) {
    const n = parseInt(readFileSync(stateFile, "utf-8").trim(), 10);
    if (Number.isFinite(n)) last = n;
  }

  const readAll = (): string[] =>
    existsSync(file) ? readFileSync(file, "utf-8").split("\n").filter(Boolean) : [];

  const start = Date.now();
  while (Date.now() - start < maxWaitSec * 1000) {
    const decision = pollDecision(captureAlive(cfg), readAll(), last);
    if (decision.kind === "dead") {
      process.stdout.write('{"type":"capture-dead"}\n');
      return;
    }
    if (decision.kind === "ready") break;
    await sleep(tick);
  }

  const all = readAll();
  if (all.length > last) {
    const pending = filterLines(all.slice(last));
    if (pending.length) process.stdout.write(pending.join("\n") + "\n");
  }
  writeFileSync(stateFile, String(all.length));
}
