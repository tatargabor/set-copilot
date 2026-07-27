/**
 * The file-facing half of the stitch: resolving inputs, writing artifacts, reporting.
 *
 * Kept separate from `transcript-build.ts` (which stays pure and unit-tested) and from
 * `cli.ts` (which stays a dispatcher), because both the `transcript` command and the
 * stop-time handover need exactly this and nothing more.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type { CopilotConfig } from "./config.js";
import { globToRegExp } from "./knowledge/sources.js";
import { stitchText, type RedactionWindow, type StitchStats } from "./transcript-build.js";

export interface StitchArtifacts {
  input: string;
  markdown: string;
  structured: string;
  stats: StitchStats;
}

/** `<name>.jsonl` → `<name>.md` + `<name>-stitched.jsonl`, beside the input. */
export function artifactPaths(input: string, out?: string): { markdown: string; structured: string } {
  const stem = input.replace(/\.jsonl$/i, "");
  const markdown = out ?? `${stem}.md`;
  const structured = `${markdown.replace(/\.md$/i, "")}-stitched.jsonl`;
  return { markdown, structured };
}

/**
 * Stitch one transcript file and write its artifacts.
 *
 * Returns `null` when there was nothing to stitch — an empty or speechless transcript.
 * Nothing is written in that case: a zero-byte `.md` would look like a meeting where
 * nobody spoke, which is a different claim from "not stitched".
 */
export function stitchFile(
  input: string,
  cfg: CopilotConfig,
  opts: { out?: string; speakers?: Record<string, string>; redactions?: RedactionWindow[] } = {},
): StitchArtifacts | null {
  const result = stitchText(readFileSync(input, "utf-8"), {
    speakers: { ...cfg.transcript.speakers, ...opts.speakers },
    completeWords: cfg.transcript.completeWords,
    pauseGapMs: cfg.transcript.pauseGapMs,
    redactions: opts.redactions,
  });
  if (!result) return null;

  const paths = artifactPaths(input, opts.out);
  writeFileSync(paths.markdown, result.markdown);
  writeFileSync(paths.structured, result.jsonl);
  return { input, markdown: paths.markdown, structured: paths.structured, stats: result.stats };
}

/** Our own output — never an input, or a re-run would stitch its own results. */
const isArtifact = (name: string): boolean => name.endsWith("-stitched.jsonl");

/**
 * A file the capture wrote, by the names it writes: `transcriptOutput` /
 * `dictationOutput` and their `-<ISO stamp>` archives. Used only when scanning a
 * DIRECTORY — a runtime dir also holds `wall-events.jsonl`, which is a `.jsonl` and is
 * emphatically not a transcript. A glob is taken at its word instead: the user named
 * what they meant.
 */
const isCaptureOutput = (name: string): boolean =>
  /\.jsonl$/i.test(name) && /^(transcript|dictation)/i.test(name) && !isArtifact(name);

/**
 * Resolve `--input` into a list of transcript files: a file as itself, a directory as
 * every capture output in it, a glob as its matches. Sorted by name, which for the
 * archive's `<name>-<ISO timestamp>.jsonl` convention is also chronological.
 */
export function resolveInputs(pattern: string, cwd = process.cwd()): string[] {
  const abs = isAbsolute(pattern) ? pattern : resolve(cwd, pattern);

  if (/[*?]/.test(pattern)) {
    const dir = dirname(abs);
    if (!existsSync(dir)) return [];
    const re = globToRegExp(abs);
    return readdirSync(dir)
      .map((f) => join(dir, f))
      .filter((f) => !isArtifact(f) && re.test(f))
      .sort();
  }

  if (!existsSync(abs)) return [];
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs)
      .filter(isCaptureOutput)
      .map((f) => join(abs, f))
      .sort();
  }
  // An explicit file is used as given — a project may name its transcripts anything.
  return [abs];
}

/** `mic=Gábor,system=Robi` → a speaker map. Malformed pairs are skipped, not fatal. */
export function parseSpeakerMap(spec: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of spec.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

/** Load `--redact`: a JSON array of `{from, to, reason}` windows. */
export function loadRedactions(path: string): RedactionWindow[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array of {from,to,reason}`);
  return raw
    .filter(
      (r): r is RedactionWindow =>
        !!r && typeof r.from === "number" && typeof r.to === "number" && typeof r.reason === "string",
    )
    .map((r) => ({ from: r.from, to: r.to, reason: r.reason }));
}

export function formatStats(a: StitchArtifacts): string {
  const s = a.stats;
  return (
    `[stitch] ${basename(a.input)}: segments=${s.segments} sentences=${s.sentences} · ` +
    `word boundaries: exact=${s.exact} guessed=${s.guessed} (of those glued=${s.healed})` +
    (s.rotated ? " · capture rotation repaired" : "")
  );
}
