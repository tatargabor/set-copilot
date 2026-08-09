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

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import type { CopilotConfig } from "./config.js";
import { stitchText } from "./transcript-build.js";

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

/** Where the handover's artifacts landed — what the project command is told about. */
export interface HandoverPaths {
  /** The archived raw transcript. Always present: it is the invariant. */
  archived: string;
  /** The readable transcript, when the stitch produced one. */
  markdown?: string;
  /** The sentence-level JSONL, when the stitch produced one. */
  structured?: string;
}

/**
 * Run the project's own hand-off, after the archive and the derived artifacts.
 *
 * This is the seam that lets a project stop forking the meeting-copilot skill: its
 * transcript hand-off (lifting the file out of the gitignored runtime dir into the
 * project's inputs) is project knowledge, and had nowhere else to live. Measured
 * 2026-07-30, without it: six transcripts stayed unhanded under `.set/copilot/`, the
 * largest 18 500 words, with nothing anywhere pointing at them.
 *
 * **It cannot fail the handover.** Non-zero exit, missing executable, or exceeding the
 * limit is reported and the caller carries on — the same posture `stitchAtStop` takes, for
 * the reason stated there: the `renameSync` is the invariant, everything after it is
 * convenience. A project script that throws must not be able to make a meeting look
 * unhanded.
 *
 * Context arrives through the ENVIRONMENT, not through placeholder substitution: the values
 * are file paths, and substituting them into a shell string is a quoting bug waiting for the
 * first space in a path. `COPILOT_HANDOVER_SLUG` is passed through when the caller's
 * environment carries it — the meeting's topic is the session's knowledge, not the
 * capture's, so the skill supplies it on the stop line.
 *
 * stdio is inherited rather than captured, so the project's own report of where the
 * transcript landed reaches the operator instead of vanishing into a buffer.
 */
export function runHandoverCommand(cfg: CopilotConfig, paths: HandoverPaths): void {
  const command = cfg.copilot.handoverCommand;
  if (!command) return;
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    timeout: HANDOVER_COMMAND_TIMEOUT_MS,
    cwd: process.cwd(),
    env: {
      ...process.env,
      SET_COPILOT_DIR: cfg.runtimeDir,
      SET_COPILOT_TRANSCRIPT: paths.archived,
      ...(paths.markdown ? { SET_COPILOT_TRANSCRIPT_MD: paths.markdown } : {}),
      ...(paths.structured ? { SET_COPILOT_TRANSCRIPT_JSONL: paths.structured } : {}),
    },
  });
  const failure =
    result.error ? result.error.message
    : result.signal === "SIGTERM" ? `timed out after ${HANDOVER_COMMAND_TIMEOUT_MS / 1000}s`
    : result.status !== 0 ? `exited with ${result.status}`
    : null;
  if (failure) {
    console.error(
      `[set-copilot] copilot.handoverCommand failed (${failure}): ${command}\n` +
      `              The transcript is handed over and intact at ${paths.archived}`,
    );
  }
}

/** Long enough for a file move plus a small index write; short enough not to hang a stop. */
const HANDOVER_COMMAND_TIMEOUT_MS = 60_000;

/**
 * Print the dictated text (dictation's /dd path), then hand it over.
 *
 * What reaches stdout is the **reassembled text**, not the raw JSONL (dictation-output).
 * The skill used to be told to "concatenate the `text` fields", which asks the consumer to
 * supply a separator it cannot know: `cont` without `midWord` means a space, `cont` with it
 * means none, and neither fact is visible to something told only to concatenate. From a
 * real dictation, that turned `"…a SetPromo-ból a ide, a"` + `"meetingek át lettek szedve?"`
 * into `…a ide, ameetingek…` — the user's own question corrupted before the model read it,
 * with no recording to go back to. The stitch already knows the answer; it just was not
 * wired to this path.
 *
 * The archive step is unchanged and still delegates to `handoverTranscriptOnce`, so a
 * single `renameSync` stays the one source of truth for "exactly once" — that invariant
 * never depended on the output format. The print still happens BEFORE the archive, reading
 * the live file. No derived artifacts are written here: for a dictation the text is a
 * message, not a document, and that decision stands.
 *
 * **Fail open — the deliberate opposite of `wall.redaction`.** If the stitch throws, or
 * yields nothing from a non-empty transcript, the raw contents are printed instead. The
 * difference is the direction of harm: on a public wall a mistake *publishes* something, so
 * withholding is safe; here a mistake would *swallow the user's instruction*, and silence is
 * the harm. A badly joined word boundary is visible to the reader and recoverable; a
 * dictation that vanishes is not — the user has already spoken and has no copy. The
 * fallback writes to stderr so a persistent failure is noticeable rather than quietly
 * degrading every dictation.
 *
 * Returns the saved archive path, or `null` when there was nothing to print/archive.
 */
export function printTranscriptOnce(cfg: CopilotConfig): string | null {
  const out = lastTranscript(cfg);
  if (!existsSync(out) || statSync(out).size === 0) return null;
  const raw = readFileSync(out, "utf-8");

  let text: string | null = null;
  try {
    const result = stitchText(raw, {
      // Optional-chained on purpose: `printTranscriptOnce` is exported from the library,
      // and a caller passing a hand-built config should get the stitch's defaults, not the
      // raw-transcript fallback via a thrown TypeError.
      speakers: cfg.transcript?.speakers,
      completeWords: cfg.transcript?.completeWords,
      pauseGapMs: cfg.transcript?.pauseGapMs,
    });
    text = result?.plain.trim() || null;
  } catch (err) {
    console.error(`[set-copilot] dictation stitch failed (${(err as Error).message}) — printing the raw transcript`);
  }

  if (text === null) {
    // A transcript of nothing but recognised non-speech events (a `silence` marker, a
    // `reconnect` note) legitimately has no text, and printing its raw JSONL would hand the
    // model machinery instead of a message. Anything else — including a line the parser
    // could not read — falls back to raw, because "the parser did not understand it" is
    // exactly the case where refusing to print would swallow what the user said.
    if (!onlyNonSpeech(raw)) {
      console.error("[set-copilot] dictation stitch produced no text — printing the raw transcript");
      process.stdout.write(raw);
    }
  } else {
    process.stdout.write(`${text}\n`);
  }
  return handoverTranscriptOnce(cfg);
}

/** Is every line in this transcript a recognisable non-speech event object? */
function onlyNonSpeech(raw: string): boolean {
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  return lines.every((line) => {
    try {
      const o = JSON.parse(line) as { type?: unknown };
      return typeof o.type === "string";
    } catch {
      return false; // unparseable: not something we may decide is "no text"
    }
  });
}
