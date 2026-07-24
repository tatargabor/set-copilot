/**
 * Transcript handover — the "exactly once" invariant shared by dictation and the
 * meeting copilot.
 *
 * A capture appends to its transcript as it runs, so the file is already durable
 * mid-capture; the missing piece is the *stop-time handover*: archiving the live
 * transcript to a timestamped name so no later capture or repeated stop can replay
 * it as if freshly spoken. Dictation additionally prints the contents (the text IS
 * the user's message); the meeting path archives silently and reports the path.
 *
 * Both routes funnel through the single `renameSync` in `handoverTranscriptOnce`,
 * which stays the one source of truth for "handed over exactly once".
 */

import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import type { CopilotConfig } from "./config.js";

/**
 * The transcript the last capture in this runtime dir wrote. The capture records
 * it, because only the capture knows whether it ran in dictation or meeting mode.
 */
export function lastTranscript(cfg: CopilotConfig): string {
  const marker = join(cfg.runtimeDir, "capture.output");
  if (existsSync(marker)) return readFileSync(marker, "utf-8").trim();
  return cfg.dictationOutput;
}

/**
 * Archive the transcript by renaming it to `<name>-<timestamp>.jsonl`, and return
 * the saved path — WITHOUT printing the contents. Handing it over consumes it: the
 * single `renameSync` here is the source of truth for the "exactly once" invariant,
 * so a later stop (a double /dd, or one after the capture self-stopped on its timer)
 * can't replay the same transcript as if freshly spoken. No-op returning `null` when
 * there is nothing to hand over (the transcript is missing or empty).
 */
export function handoverTranscriptOnce(cfg: CopilotConfig): string | null {
  const out = lastTranscript(cfg);
  if (!existsSync(out) || statSync(out).size === 0) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archived = `${out.replace(/\.jsonl$/, "")}-${stamp}.jsonl`;
  renameSync(out, archived);
  return archived;
}

/**
 * Print the transcript contents (dictation's /dd path), then hand it over. The
 * archive step is shared with the meeting path via `handoverTranscriptOnce`, so a
 * single `renameSync` stays the one source of truth for "exactly once". Returns the
 * saved archive path, or `null` when there was nothing to print/archive.
 */
export function printTranscriptOnce(cfg: CopilotConfig): string | null {
  const out = lastTranscript(cfg);
  if (!existsSync(out) || statSync(out).size === 0) return null;
  process.stdout.write(readFileSync(out, "utf-8"));
  return handoverTranscriptOnce(cfg);
}
