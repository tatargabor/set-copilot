/**
 * The scenario player — `set-copilot replay`.
 *
 * Writes a scenario's lines into a runtime dir's transcript, paced by the scenario's
 * own timestamps, while holding the runtime dir the way a capture does. A consumer
 * polling that dir cannot tell the difference, and that indistinguishability is the
 * entire basis of the harness: what gets measured is the production path, not a mock.
 *
 * Three things here are load-bearing.
 *
 * **Pacing is deadline-based, never accumulated sleeps.** Each entry's target time is
 * computed from the run's start. Sleep drift over a 40-minute scenario would stretch
 * the run silently and corrupt exactly the latency figures this exists to produce.
 *
 * **The player reports when IT is late.** If the process falls behind its own schedule
 * — a loaded machine, a slow disk — that has to be visible, or a slow player would be
 * scored as a slow copilot.
 *
 * **Speed is an validity fact, not a label.** It travels into the run record, and a
 * scorecard built on a non-real-time run reports its latency dimensions as invalid
 * rather than as numbers. The tempting shortcut — noting the speed in a filename — is
 * how a flattering figure from a fast run gets quoted later as if it were real.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CopilotConfig } from "./config.js";
import { claimRuntimeDir, RuntimeDirBusyError, type RuntimeClaim } from "./runtime-dir.js";
import {
  entryTs, loadValidScenario, playableOf, type Scenario, type ScriptEntry,
} from "./replay-scenario.js";

/** `--speed 0` means "as fast as possible": no inter-entry delay at all. */
export const SPEED_MAX = 0;

/** Beyond this much lateness the player says so — a slow player is not a slow copilot. */
export const LATENESS_WARN_MS = 1500;

export interface ReplayOptions {
  scenarioDir: string;
  /** Playback speed multiplier. 1 = real time (default); 0 = as fast as possible. */
  speed?: number;
  /** Where to write. Defaults to the config's transcript output. */
  output?: string;
  log?: (msg: string) => void;
}

/** What a run records about itself, so a scorecard knows what it may claim. */
export interface ReplayRunRecord {
  scenario: string;
  /** Content fingerprint — a comparison across two different ones is refused. */
  fingerprint: string;
  speed: number;
  /**
   * Whether this run may report latency at all. False for any speed but real time:
   * a model's thinking time does not scale with playback, so a sped-up run flatters
   * the copilot and its elapsed-time figures mean nothing.
   */
  realTime: boolean;
  output: string;
  startedAt: number;
  finishedAt?: number;
  entries: number;
  /** The worst lateness the player itself incurred, ms. High values invalidate latency too. */
  maxLatenessMs?: number;
}

/**
 * Wall-clock time an entry is due, given when the run started.
 *
 * Pure and takes the start as an argument precisely so the schedule can be asserted
 * without waiting for it. At `SPEED_MAX` everything is due immediately.
 */
export function dueAt(entryMs: number, startedAt: number, speed: number): number {
  if (speed === SPEED_MAX) return startedAt;
  return startedAt + entryMs / speed;
}

/** How late writing an entry was against its own deadline. Never negative. */
export function latenessOf(entryMs: number, startedAt: number, speed: number, now: number): number {
  return Math.max(0, now - dueAt(entryMs, startedAt, speed));
}

/**
 * Rebase a scenario's relative timestamps onto real ones.
 *
 * The fixture counts from zero so it can be replayed any day; the transcript must
 * carry real timestamps because that is what a capture writes and what every consumer
 * reads. `startTs` moves with `ts`, so the utterance-ordering field a two-channel
 * reader depends on survives the rebase.
 */
export function rebase(playable: Record<string, unknown>, baseTs: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...playable };
  if (typeof out.ts === "number") out.ts = out.ts + baseTs;
  if (typeof out.startTs === "number") out.startTs = out.startTs + baseTs;
  return out;
}

/** `mm:ss` of a scenario offset — the timeline and the progress line share one clock. */
export function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** One progress line: where the run stands and what is being played. */
export function progressLine(entry: ScriptEntry): string {
  const at = stamp(entryTs(entry));
  const section = entry.section ? ` ${entry.section} ·` : "";
  if (entry.event) return `[${at}]${section} (${entry.event.type})`;
  const l = entry.line as { speaker: string; text: string };
  return `[${at}]${section} ${l.speaker}: ${l.text}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Validate a speed argument, returning it or throwing with what is wrong. */
export function parseSpeed(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --speed "${raw}" (expected 0 or a positive number)`);
  return n;
}

export interface ReplayResult {
  record: ReplayRunRecord;
  scenario: Scenario;
}

/**
 * Play a scenario into a runtime dir.
 *
 * Refuses a dir with a live owner, reclaims a stale one, archives an unconsumed
 * transcript — all through the shared ownership module, so `capture` and `replay`
 * cannot drift apart on the one rule that protects a live recording.
 */
export async function runReplay(cfg: CopilotConfig, opts: ReplayOptions): Promise<ReplayResult> {
  const log = opts.log ?? console.log;
  const speed = opts.speed ?? 1;
  const scenario = loadValidScenario(opts.scenarioDir);
  const output = opts.output ?? cfg.transcriptOutput;

  let claim: RuntimeClaim;
  try {
    claim = claimRuntimeDir({ runtimeDir: cfg.runtimeDir, output, log });
  } catch (err) {
    if (err instanceof RuntimeDirBusyError) {
      throw new Error(
        `${err.message}\n[set-copilot] replay refuses to write into a runtime dir someone else owns — the transcript is untouched.`,
      );
    }
    throw err;
  }

  const startedAt = Date.now();
  const record: ReplayRunRecord = {
    scenario: scenario.meta.name,
    fingerprint: scenario.fingerprint,
    speed,
    realTime: speed === 1,
    output,
    startedAt,
    entries: 0,
    maxLatenessMs: 0,
  };
  const recordPath = join(cfg.runtimeDir, "replay-run.json");
  writeFileSync(recordPath, JSON.stringify(record, null, 2));

  log(`[set-copilot] Replaying "${scenario.meta.name}" (${scenario.script.length} entries, ${stamp(scenario.durationMs)})`);
  log(`[set-copilot] Speed: ${speed === SPEED_MAX ? "max (not real time)" : `${speed}x`}${record.realTime ? "" : " — latency figures from this run are INVALID"}`);
  log(`[set-copilot] Output: ${output}`);

  let warnedLate = false;
  try {
    for (const entry of scenario.script) {
      const ms = entryTs(entry);
      const wait = dueAt(ms, startedAt, speed) - Date.now();
      if (wait > 0) await sleep(wait);

      const late = latenessOf(ms, startedAt, speed, Date.now());
      if (late > (record.maxLatenessMs ?? 0)) record.maxLatenessMs = late;
      if (late > LATENESS_WARN_MS && !warnedLate) {
        warnedLate = true;
        // Said once, loudly: a player that cannot keep its own schedule would otherwise
        // be scored as a copilot that cannot keep up.
        console.error(
          `[set-copilot] replay is running ${Math.round(late)}ms behind its own schedule — this run's latency figures describe the PLAYER, not the copilot.`,
        );
      }

      appendFileSync(output, JSON.stringify(rebase(playableOf(entry) as Record<string, unknown>, startedAt)) + "\n");
      record.entries++;
      log(progressLine(entry));
    }
  } finally {
    record.finishedAt = Date.now();
    writeFileSync(recordPath, JSON.stringify(record, null, 2));
    // Releasing the claim is what a consumer reads as the capture ending — the same
    // signal a real capture gives when it stops.
    claim.release();
  }

  const wall = ((record.finishedAt - startedAt) / 1000).toFixed(1);
  log(`[set-copilot] Replay finished: "${scenario.meta.name}" · speed ${speed === SPEED_MAX ? "max" : `${speed}x`} · ${record.entries} entries · ${wall}s wall clock`);
  if (!record.realTime) log("[set-copilot] This run was not real time — its latency figures are not valid.");
  return { record, scenario };
}
