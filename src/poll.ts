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
    if (
      line.includes('"type":"silence"') ||
      line.includes('"type":"reconnect"') ||
      // A spoken command and its abandonment carry `text`/`partial`, but they must never
      // be dropped by the echo dedup either: an instruction repeated verbatim ("copilot
      // rajzold meg CSINÁLD" twice, because the first drew the wrong thing) is a second
      // instruction, not an echo of the first.
      line.includes('"type":"command"') ||
      line.includes('"type":"command-abandoned"')
    ) {
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

/**
 * Extract operator-typed wall inputs (wall-input) from raw JSONL lines.
 *
 * Pure, and deliberately SEPARATE from `filterLines`: the transcript's echo-dedup exists
 * because a recogniser repeats itself, but an operator who sends the same instruction
 * twice means it twice — the dedup would silently swallow the second send. Blank and
 * malformed lines are skipped (a half-written line is never handed over), and `next`
 * points past everything consumed so the offset only ever advances over content.
 */
export function wallInputsFrom(lines: string[], last: number): { texts: string[]; next: number } {
  const texts: string[] = [];
  let next = last;
  for (let i = last; i < lines.length; i++) {
    next = i + 1; // consumed, valid or not — the file is append-only operator input
    let text: string | undefined;
    try {
      const o = JSON.parse(lines[i]) as { text?: unknown };
      if (typeof o?.text === "string" && o.text.trim()) text = o.text;
    } catch {
      text = undefined;
    }
    if (text !== undefined) texts.push(text);
  }
  return { texts, next };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What one tick of the poll decides to do. */
export type PollAction =
  /** Stop waiting and hand over what is pending. */
  | { kind: "ready"; reason: "early" | "capture-gone" | "dwell" }
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
/** A speech line, as opposed to a non-speech event. Events have their own trigger. */
function isSpeech(line: string): boolean {
  return line.includes('"speaker"') && !line.includes('"type":"');
}

export function pollDecision(alive: boolean, all: string[], last: number, dwell = 0): PollAction {
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
        l.includes('"command":true') ||
        // The fast lane (fast-lane.ts): a bracketed spoken instruction is complete by
        // construction — the speaker said the closing word — so it goes over at the
        // next 250 ms tick rather than behind the ambient gate. This is the whole
        // point of the lane: inference is what the gate exists for, and there is none
        // here. The abandonment is included for the same reason a reconnect is: the
        // operator needs to know their command did not take, immediately.
        l.includes('"type":"command"') ||
        l.includes('"type":"command-abandoned"'),
    ) ||
    (unread.some((l) => l.includes('"type":"silence"')) && unread.some((l) => l.includes('"speaker"')));

  if (early) return { kind: "ready", reason: "early" };

  // Bound how long a line can sit unseen during continuous speech. Speech lines are
  // already complete sentences (the writer flushes on `. ? !`), so a batch of them is
  // coherent without a pause to confirm it — and without this bound the wait for that
  // pause measured 30.7 s on average during a presentation.
  //
  // Speech only: a run of events is not something to react to, and the events that are
  // have their own trigger above.
  if (dwell > 0 && unread.filter(isSpeech).length >= dwell) {
    return { kind: "ready", reason: "dwell" };
  }

  return { kind: "wait" };
}

/**
 * Long-poll the transcript (and the wall-input seam, wall-input-to-session). Blocks until
 * a reaction-worthy event appears or maxWaitSec elapses, then prints the accumulated
 * (filtered) lines to stdout.
 *
 * Early return when the fresh batch contains an urgent line, a question, or a
 * silence event that closes a spoken thought unit — or an operator input from the wall,
 * which returns at the next tick like a spoken command: it is an instruction, and the
 * inference gate the poll exists for has nothing to do with it.
 *
 * Wall input is checked BEFORE the dead verdict, for the same reason the transcript is
 * drained before it: reporting a dead capture before reading what is pending would
 * discard it, and an operator who typed at the wall deserves their instruction delivered
 * even as the capture exits. The transcript offset is NOT advanced by wall input — the
 * two channels keep their own offsets, and a repeated wall input is a repeated
 * instruction, never an echo.
 *
 * When the capture is gone, the remaining unread lines are handed over FIRST and
 * {"type":"capture-dead"} is emitted on the following poll, once there is nothing
 * left. The old order — notice first, read never — silently dropped everything said
 * between a consumer's last poll and the capture's exit.
 */
export async function runPoll(cfg: CopilotConfig, maxWaitSec = 60): Promise<void> {
  const file = cfg.transcriptOutput;
  const stateFile = join(cfg.runtimeDir, "poll-offset");
  const inputFile = join(cfg.runtimeDir, "wall-input.jsonl");
  const inputStateFile = join(cfg.runtimeDir, "wall-input-offset");
  // 250ms, not 2000: the tick is pure detection granularity added to every reaction,
  // and re-reading one small file eight times a second costs nothing next to the
  // seconds it saves. Measured: the old tick added up to 2s to every round.
  const tick = 250;

  let last = 0;
  if (existsSync(stateFile)) {
    const n = parseInt(readFileSync(stateFile, "utf-8").trim(), 10);
    if (Number.isFinite(n)) last = n;
  }
  let lastInput = 0;
  if (existsSync(inputStateFile)) {
    const n = parseInt(readFileSync(inputStateFile, "utf-8").trim(), 10);
    if (Number.isFinite(n)) lastInput = n;
  }

  const readAll = (): string[] =>
    existsSync(file) ? readFileSync(file, "utf-8").split("\n").filter(Boolean) : [];
  const readInputs = (): string[] =>
    existsSync(inputFile) ? readFileSync(inputFile, "utf-8").split("\n").filter(Boolean) : [];

  /** Emit every pending wall input; true when anything was written. */
  const drainInputs = (): boolean => {
    const { texts, next } = wallInputsFrom(readInputs(), lastInput);
    if (!texts.length) return false;
    for (const t of texts) {
      process.stdout.write(`${JSON.stringify({ type: "wall-input", text: t })}\n`);
    }
    lastInput = next;
    writeFileSync(inputStateFile, String(lastInput));
    return true;
  };

  const start = Date.now();
  while (Date.now() - start < maxWaitSec * 1000) {
    // Wall input first: it is an instruction, and it must also survive the capture's
    // exit — drain-before-dead, the same order the transcript side already paid for.
    if (drainInputs()) return;
    const decision = pollDecision(captureAlive(cfg), readAll(), last, cfg.copilot.pollDwell);
    if (decision.kind === "dead") {
      process.stdout.write('{"type":"capture-dead"}\n');
      return;
    }
    if (decision.kind === "ready") break;
    await sleep(tick);
  }

  drainInputs();
  const all = readAll();
  if (all.length > last) {
    const pending = filterLines(all.slice(last));
    if (pending.length) process.stdout.write(pending.join("\n") + "\n");
  }
  writeFileSync(stateFile, String(all.length));
}
