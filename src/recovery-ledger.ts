/**
 * The recovery ledger — migration semantics for transcript recovery.
 *
 * `transcript-stitch` shipped the mechanism; running it across two real projects showed the
 * mechanism was never the bottleneck. The expensive step is a model *reading* a whole
 * meeting to find what was said that never reached the notes, and that step must run **once
 * per transcript, ever** — like a migration.
 *
 * Two design facts follow, and both are load-bearing:
 *
 * 1. **The ledger is engine-owned, not prompt-owned.** A skill told to "remember you already
 *    reviewed this" will eventually not remember. This repo already paid for that lesson:
 *    the chat→wall mirror began as a prompt mandate and a live meeting measured it falling
 *    behind badly enough that it was rebuilt as a `Stop` hook. A recovery review is the
 *    worse case — forgetting means re-reading a whole meeting, or losing the same knowledge
 *    twice if a stale status is trusted. So the record is written by code, as a side effect
 *    of doing the work.
 * 2. **The key is a content fingerprint, not a path.** The handover renames every file it
 *    archives and recordings get copied between repos, so a path is not stable. A SHA-256 of
 *    the contents is, and it answers the awkward cases for free: two copies of one recording
 *    are one transcript, and a file whose content changed is a new transcript that has not
 *    been reviewed.
 *
 * Append-only JSONL, mirroring `wall-events.jsonl` — the project's existing precedent for a
 * log that is the rebuild source and is rotated, never rewritten. It is **advisory** by
 * construction: a missing ledger means everything is pending, a corrupt line is skipped, and
 * the artifacts on disk stay the real evidence. Losing it costs redone work, never data.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { CopilotConfig } from "./config.js";

/**
 * The stitch algorithm's version, recorded on every entry.
 *
 * Bump it when the algorithm changes what it produces. It is recorded so a report can say
 * "12 transcripts were recovered under an older version" — it **never** triggers a redo.
 * The algorithm changed twice in the session that produced this design (the false-terminator
 * rule and the merged-sentence cap), and under a redo-when-stale policy each of those would
 * have invalidated every prior result, turning a patch release into an unbounded model-pass
 * bill across every project's archive. The operator decides, with `--force`.
 */
export const STITCH_VERSION = 1;

/** The recovery steps a transcript passes through. */
export type RecoveryStep = "stitch" | "review";

export const RECOVERY_STEPS: readonly RecoveryStep[] = ["stitch", "review"];

export function isRecoveryStep(s: string): s is RecoveryStep {
  return (RECOVERY_STEPS as readonly string[]).includes(s);
}

/**
 * What an entry asserts about its step.
 *
 * `claimed` is deliberately its own state rather than a flavour of pending: an interrupted
 * review is a fact worth keeping — it says someone started and did not finish — and folding
 * it into "pending" would throw that away, while folding it into "done" would assert a
 * review that never happened, which is the one failure mode that loses knowledge silently.
 */
export type EntryState = "claimed" | "done" | "abandoned";

export interface LedgerEntry {
  /** SHA-256 of the transcript's contents — the identity. */
  fingerprint: string;
  step: RecoveryStep;
  state: EntryState;
  /** ISO timestamp. */
  at: string;
  /** `STITCH_VERSION` at the time this entry was written. */
  version: number;
  /** Where the file was when this ran. A hint for a human reading the log — NEVER matched on. */
  path?: string;
  /** Step outcome: sentence counts for a stitch, finding counts for a review. */
  outcome?: Record<string, unknown>;
  /** Why a review was abandoned. */
  reason?: string;
}

/** SHA-256 of a file's contents. The path is never part of the key. */
export function fingerprintFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The project's ledger.
 *
 * At the PROJECT root rather than in a per-session runtime dir, because recovery is a
 * cross-session activity: it reads every session's archive at once, and a per-session ledger
 * would answer the wrong question. It follows `cfg.projectRoot`, so recovering a recording
 * that lives in another repo records the fact in the project doing the recovering — which is
 * where the next run will look.
 */
export function ledgerPath(cfg: CopilotConfig): string {
  return join(cfg.projectRoot, ".set", "copilot", "recovery-log.jsonl");
}

/**
 * Read the ledger, tolerantly. A missing file is an empty ledger, not an error, and a line
 * that will not parse is skipped — one bad append must never cost the other 200 records.
 */
export function readLedger(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  let raw: string;
  try { raw = readFileSync(path, "utf-8"); } catch { return []; }
  const out: LedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s) as Partial<LedgerEntry>;
      if (typeof o.fingerprint !== "string" || !o.fingerprint) continue;
      if (typeof o.step !== "string" || !isRecoveryStep(o.step)) continue;
      const state: EntryState =
        o.state === "claimed" || o.state === "abandoned" ? o.state : "done";
      out.push({
        fingerprint: o.fingerprint,
        step: o.step,
        state,
        at: typeof o.at === "string" ? o.at : "",
        version: typeof o.version === "number" ? o.version : 0,
        ...(typeof o.path === "string" ? { path: o.path } : {}),
        ...(o.outcome && typeof o.outcome === "object" ? { outcome: o.outcome } : {}),
        ...(typeof o.reason === "string" ? { reason: o.reason } : {}),
      });
    } catch {
      continue;
    }
  }
  return out;
}

/** Append one entry. Never rewrites, never deletes — the history is the point. */
export function appendEntry(path: string, entry: LedgerEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

/** Build an entry with the fields every caller would otherwise repeat. */
export function makeEntry(
  fingerprint: string,
  step: RecoveryStep,
  state: EntryState,
  extra: { path?: string; outcome?: Record<string, unknown>; reason?: string; at?: string } = {},
): LedgerEntry {
  return {
    fingerprint,
    step,
    state,
    at: extra.at ?? new Date().toISOString(),
    version: STITCH_VERSION,
    ...(extra.path ? { path: extra.path } : {}),
    ...(extra.outcome ? { outcome: extra.outcome } : {}),
    ...(extra.reason ? { reason: extra.reason } : {}),
  };
}

/** Every entry for one transcript, in file order (which is chronological). */
export function entriesFor(entries: LedgerEntry[], fingerprint: string): LedgerEntry[] {
  return entries.filter((e) => e.fingerprint === fingerprint);
}

/** The status of one step for one transcript. */
export type StepStatus = "pending" | "done" | "claimed";

/**
 * Resolve a step's status from the whole history.
 *
 * A `done` anywhere in the history wins outright: completion is not undone by a later claim
 * (a `--force` re-run appends a fresh claim, and the work was still done once). Otherwise
 * the LAST claim/abandon decides, so an abandoned attempt returns the transcript to pending
 * while both the claim and the abandonment stay in the record.
 */
export function stepStatus(
  entries: LedgerEntry[],
  fingerprint: string,
  step: RecoveryStep,
): StepStatus {
  const mine = entriesFor(entries, fingerprint).filter((e) => e.step === step);
  if (mine.some((e) => e.state === "done")) return "done";
  const last = mine.at(-1);
  if (last?.state === "claimed") return "claimed";
  return "pending";
}

/** Has this step completed for this transcript? A claim is NOT a completion. */
export function isDone(entries: LedgerEntry[], fingerprint: string, step: RecoveryStep): boolean {
  return stepStatus(entries, fingerprint, step) === "done";
}

/** The completing entry, for reporting the version a result was produced under. */
export function doneEntry(
  entries: LedgerEntry[],
  fingerprint: string,
  step: RecoveryStep,
): LedgerEntry | undefined {
  return entriesFor(entries, fingerprint)
    .filter((e) => e.step === step && e.state === "done")
    .at(-1);
}

/** Every transcript with an unresolved claim — the state that must never read as pending. */
export function danglingClaims(entries: LedgerEntry[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.fingerprint}:${e.step}`;
    if (seen.has(key)) continue;
    if (stepStatus(entries, e.fingerprint, e.step) === "claimed") {
      seen.add(key);
      // The claim itself, not the first entry we happened to walk past.
      const claim = entriesFor(entries, e.fingerprint)
        .filter((x) => x.step === e.step && x.state === "claimed")
        .at(-1);
      if (claim) out.push(claim);
    }
  }
  return out;
}
