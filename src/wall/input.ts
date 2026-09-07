/**
 * The wall→session input seam (wall-input-to-session).
 *
 * A human at the wall can hand the session a short instruction: the page POSTs it, the
 * server appends ONE JSON line to `wall-input.jsonl` in the runtime dir, and `poll` tails
 * that file with its own offset — a second file seam beside the transcript, deliberately,
 * so the replay harness can drive it exactly as a human's keystrokes drive it.
 */

import { join } from "node:path";

/** The viewer seam file in a runtime dir — what `poll` tails and the wall appends to. */
export function wallInputPath(runtimeDir: string): string {
  return join(runtimeDir, "wall-input.jsonl");
}

export type NormalizeWallInputResult =
  | { ok: true; text: string }
  | { ok: false, reason: string };

/**
 * How long an operator-typed line may be, after trimming. Engine hygiene, not project
 * judgement — the same altitude as `DEFAULT_REDACTION.maxInputLength`: a shape bound an
 * operator UI needs, never a taxonomy an operator would tune.
 */
export const MAX_WALL_INPUT_CHARS = 400;

/** C0 controls, DEL, and the C1 range — the characters that break a one-line-per-input file. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Validate one wall-input text.
 *
 * The checks are exactly three, each forced by the file format rather than taste: an
 * empty line describes nothing; over 400 trimmed characters is not a wall instruction
 * but a document; and a control character — newline and tab included — would break the
 * one-input-is-one-JSONL-line invariant (JSON would escape it, but the text would still
 * read as two inputs where the operator sent one). Accented Hungarian and emoji pass
 * untouched: this is a control-character class, never a `\b`-shaped boundary that eats `á`.
 */
export function normalizeWallInput(raw: unknown): NormalizeWallInputResult {
  if (typeof raw !== "string") return { ok: false, reason: "text must be a string" };
  const text = raw.trim();
  if (!text) return { ok: false, reason: "text is empty" };
  if (text.length > MAX_WALL_INPUT_CHARS) {
    return { ok: false, reason: `text exceeds ${MAX_WALL_INPUT_CHARS} characters` };
  }
  if (CONTROL_CHARS.test(text)) {
    return { ok: false, reason: "text contains a control character" };
  }
  return { ok: true, text };
}
