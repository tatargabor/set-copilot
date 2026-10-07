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
import { join, relative } from "node:path";

import type { CopilotConfig } from "./config.js";
import {
  DEFAULT_TARGET_DIR, gitAddLine, persistToDefaultTarget, recordHandover, recordedAt, sha256File,
  type ContentIndex, type DefaultTargetResult, type RecordingKind, type RecordingPaths,
} from "./recording-store.js";
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
export type HandoverPaths = RecordingPaths;

export interface RecordingHandoverOptions {
  /**
   * The stdout of this process is the user's dictated message (a `/dd` stop): nothing the
   * hand-off says may reach it. The command's output is captured and re-emitted on stderr,
   * prefixed, and the built-in target reports on stderr too. False for a meeting stop and for
   * back-fill, where stdout is an ordinary report.
   */
  protectStdout?: boolean;
  /** `SET_COPILOT_DIR` for the command; defaults to `cfg.runtimeDir`. Back-fill passes the recording's own dir. */
  runtimeDir?: string;
  /** Set by back-fill: exported to the command as `SET_COPILOT_BACKFILL=1` and noted in the record. */
  backfill?: boolean;
  /** Back-fill's work-tree index, shared across one run so a duplicate within the run is caught. */
  index?: ContentIndex;
}

export type HandoverOutcome =
  | { via: "command"; key: string; ok: boolean }
  | ({ via: "default" } & DefaultTargetResult & { error?: string });

/**
 * Hand a recording on — the one seam both kinds and back-fill go through (recording-handover).
 *
 * This is what lets a project stop forking the meeting-copilot skill: its hand-off (lifting the
 * file out of the gitignored runtime dir into the project's inputs) is project knowledge, and
 * had nowhere else to live. Measured 2026-07-30, without it: six transcripts stayed unhanded
 * under `.set/copilot/`, the largest 18 500 words, with nothing anywhere pointing at them.
 *
 * **The command is chosen per kind, from the existing keys** — `copilot.handoverCommand` for a
 * meeting, `copilot.dictationHandoverCommand` for a dictation — and a kind with no command goes
 * to the built-in target (`docs/inputs/copilot/`), so a project that configured nothing still
 * keeps what was said. A meeting-only command does NOT start receiving dictations: a script
 * written before `SET_COPILOT_KIND` existed cannot tell one from the other, and the one known
 * instance would file every dictation as an internal meeting part after a `git fetch`. A project
 * that wants one script for both points both keys at it and branches on `SET_COPILOT_KIND`.
 *
 * **It cannot fail the handover.** Non-zero exit, missing executable, a time-out or a failed
 * copy is reported and the caller carries on — the `renameSync` is the invariant, everything
 * after it is convenience. A project script that throws must not make a meeting look unhanded.
 *
 * Context arrives through the ENVIRONMENT, not through placeholder substitution: the values are
 * file paths, and substituting them into a shell string is a quoting bug waiting for the first
 * space in a path. `COPILOT_HANDOVER_SLUG` passes through when the caller's environment carries
 * it — the meeting's topic is the session's knowledge, not the capture's.
 *
 * A command that exits 0 is recorded as a `handover` step in the recovery ledger: a command may
 * keep the recording in a shape the engine cannot recognise, and back-fill must not hand the
 * same recording to it again and again.
 */
export function runRecordingHandover(
  cfg: CopilotConfig,
  paths: RecordingPaths,
  kind: RecordingKind,
  opts: RecordingHandoverOptions = {},
): HandoverOutcome {
  const key = kind === "dictation" ? "copilot.dictationHandoverCommand" : "copilot.handoverCommand";
  const command = kind === "dictation" ? cfg.copilot?.dictationHandoverCommand : cfg.copilot?.handoverCommand;
  const report = opts.protectStdout ? console.error : console.log;
  let sha: string | undefined;
  const fingerprint = () => (sha ??= sha256File(paths.archived));

  if (command) {
    const ok = runProjectHandover(command, key, cfg, paths, kind, opts);
    if (ok) {
      recordHandover(cfg.projectRoot ?? process.cwd(), fingerprint(), paths.archived, {
        via: "command", kind, key, ...(opts.backfill ? { backfill: true } : {}),
      });
    }
    return { via: "command", key, ok };
  }

  try {
    const result = persistToDefaultTarget(cfg.projectRoot ?? process.cwd(), paths, kind, opts.index);
    if (result.existing) {
      report(`[set-copilot] Already saved:      ${result.existing} (same content)`);
    } else if (result.skipped) {
      report(`[set-copilot] Not saved to the repo (${result.skipped}) — the recording stays at ${paths.archived}`);
    } else if (result.top) {
      for (const f of result.written) report(`[set-copilot] Saved to the repo: ${relative(result.top, f)}`);
      report(`[set-copilot] To commit:         ${gitAddLine(result.top, result.written)}`);
    }
    if (!result.skipped) {
      recordHandover(cfg.projectRoot ?? process.cwd(), fingerprint(), paths.archived, {
        via: "default", kind,
        ...(result.written.length ? { targets: result.written } : {}),
        ...(result.existing ? { existing: result.existing } : {}),
        ...(opts.backfill ? { backfill: true } : {}),
      });
    }
    return { via: "default", ...result };
  } catch (err) {
    const error = (err as Error).message;
    console.error(
      `[set-copilot] could not save the recording to ${DEFAULT_TARGET_DIR} (${error})\n` +
      `              The recording is intact at ${paths.archived}`,
    );
    return { via: "default", written: [], error };
  }
}

/**
 * Run a project hand-off command. Returns true when it exited 0.
 *
 * stdio for a meeting (and for back-fill) is inherited, so the project's own report of where
 * the transcript landed reaches the operator instead of vanishing into a buffer. On a dictation
 * stop stdout is the channel the user's spoken words travel on — `printTranscriptOnce` has just
 * written the message there — so a script announcing "saved to docs/inputs/dictation/…" would
 * splice a sentence the user never said into their own instruction. There the output is
 * captured and re-emitted on stderr, prefixed: visible to the operator, invisible to the message.
 */
function runProjectHandover(
  command: string,
  key: string,
  cfg: CopilotConfig,
  paths: RecordingPaths,
  kind: RecordingKind,
  opts: RecordingHandoverOptions,
): boolean {
  const protect = !!opts.protectStdout;
  const result = spawnSync(command, {
    shell: true,
    stdio: protect ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf-8",
    timeout: HANDOVER_COMMAND_TIMEOUT_MS,
    cwd: process.cwd(),
    env: {
      ...process.env,
      SET_COPILOT_DIR: opts.runtimeDir ?? cfg.runtimeDir,
      SET_COPILOT_TRANSCRIPT: paths.archived,
      SET_COPILOT_KIND: kind,
      SET_COPILOT_RECORDED_AT: recordedAt(paths.archived).toISOString(),
      ...(paths.markdown ? { SET_COPILOT_TRANSCRIPT_MD: paths.markdown } : {}),
      ...(paths.structured ? { SET_COPILOT_TRANSCRIPT_JSONL: paths.structured } : {}),
      ...(opts.backfill ? { SET_COPILOT_BACKFILL: "1" } : {}),
    },
  });
  if (protect) forwardToStderr(result.stdout, result.stderr);
  const failure =
    result.error ? result.error.message
    : result.signal === "SIGTERM" ? `timed out after ${HANDOVER_COMMAND_TIMEOUT_MS / 1000}s`
    : result.status !== 0 ? `exited with ${result.status}`
    : null;
  if (failure) {
    console.error(
      `[set-copilot] ${key} failed (${failure}): ${command}\n` +
      `              The transcript is handed over and intact at ${paths.archived}`,
    );
    return false;
  }
  return true;
}

/**
 * Re-emit a captured hand-off's output on stderr, one prefixed line at a time.
 *
 * Prefixed rather than raw because this text lands next to the dictated message in the
 * same terminal scrollback: the marker is what tells a reader (and the model reading the
 * stop's output) that these lines are the tooling talking, not the speaker.
 */
function forwardToStderr(...streams: (string | null | undefined)[]): void {
  for (const stream of streams) {
    for (const line of (stream ?? "").split("\n")) {
      if (line.trim()) console.error(`[set-copilot] handover: ${line}`);
    }
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
