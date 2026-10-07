/**
 * Back-fill — find the recordings this machine never saved, and save them (recording-handover).
 *
 * The stop-time hand-off only helps from the day it exists. Everything recorded before — and
 * anything a failed command or a crashed session left behind — sits in `.set/copilot/`, which
 * is gitignored and machine-local. Measured 2026-10-07 by a content-hash survey: 15 dictations
 * in one project, 14 meeting transcripts in another, with no copy anywhere in their repos.
 *
 * Three rules shape it, each borrowed from an invariant that already holds elsewhere:
 *
 * - **It copies, never moves.** "Handed over exactly once" belongs to `stop`'s single
 *   `renameSync`. Back-fill reads runtime dirs and writes only into the work tree (and the
 *   readable artifacts beside a recording, which is what a stop writes too).
 * - **Same seam as a stop.** A recording goes to the project's command for its kind, or to the
 *   built-in target — `runRecordingHandover`, not a second path that could disagree with it.
 * - **Identity is content.** "Saved" means a byte-identical copy in the work tree, or a
 *   successful command hand-off of the same SHA-256 in the recovery ledger. Never a name.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import type { CopilotConfig } from "./config.js";
import { runRecordingHandover, type HandoverOutcome } from "./handover.js";
import {
  ContentIndex, DEFAULT_TARGET_DIR, commandHandedOver, gitAddLine, gitToplevel, hasSpeech, kindOf, localDate,
  readBackfillMarker, recordedAt, sha256File, walkFiles, writeBackfillMarker,
  type BackfillMarker, type RecordingKind,
} from "./recording-store.js";
import { captureAlive } from "./runtime-dir.js";
import { artifactPaths, isCaptureOutput, stitchFile } from "./transcript-stitch-run.js";

export interface Recording {
  path: string;
  kind: RecordingKind;
  size: number;
  sha256: string;
  recordedAt: Date;
  lines: number;
}

export interface RecordingScan {
  recordings: Recording[];
  /** Live-named files left alone because a capture is writing them. */
  live: string[];
  /** Files with no speech at all (empty, or only silence/reconnect events). */
  speechless: number;
}

/** How deep under `.set/copilot/` to look. One survey found a recording nested a level down. */
const SCAN_DEPTH = 4;

const LIVE_NAME = /^(dictation|transcript)\.jsonl$/;

/**
 * Every recording under `<projectRoot>/.set/copilot/`, oldest first.
 *
 * Only this project's scoped runtime dirs: the global runtime dir (`/tmp/set-copilot` by
 * default) is shared by every project on the machine, and its recordings cannot be attributed
 * to this one. A live-named file is a recording only when no capture is alive in its dir.
 */
export function scanRecordings(projectRoot: string): RecordingScan {
  const base = join(resolve(projectRoot), ".set", "copilot");
  const recordings: Recording[] = [];
  const live: string[] = [];
  let speechless = 0;
  for (const path of walkFiles(base, SCAN_DEPTH)) {
    const name = basename(path);
    if (!isCaptureOutput(name)) continue;
    // A replay run writes a `transcript.jsonl` played back from a scenario fixture — not a
    // recording of this machine's speech, and possibly private material.
    if (existsSync(join(dirname(path), "replay-run.json"))) continue;
    if (LIVE_NAME.test(name) && captureAlive(dirname(path))) { live.push(path); continue; }
    let raw: string;
    try { raw = readFileSync(path, "utf-8"); } catch { continue; }
    if (!hasSpeech(raw)) { speechless++; continue; }
    recordings.push({
      path,
      kind: kindOf(path),
      size: statSync(path).size,
      sha256: sha256File(path),
      recordedAt: recordedAt(path),
      lines: raw.split("\n").filter((l) => l.trim()).length,
    });
  }
  recordings.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.path.localeCompare(b.path));
  return { recordings, live, speechless };
}

export interface Classified {
  top: string;
  unsaved: Recording[];
  saved: { recording: Recording; evidence: string }[];
  index: ContentIndex;
}

/** Split recordings into saved / unsaved. Null outside a git work tree — there is nowhere to look. */
export function classifyRecordings(projectRoot: string, recordings: Recording[]): Classified | null {
  const top = gitToplevel(projectRoot);
  if (!top) return null;
  const index = new ContentIndex(top);
  const handed = commandHandedOver(projectRoot);
  const unsaved: Recording[] = [];
  const saved: Classified["saved"] = [];
  const seen = new Set<string>();
  for (const r of recordings) {
    const copy = index.find(r.sha256, r.size);
    if (copy) { saved.push({ recording: r, evidence: copy }); continue; }
    if (handed.has(r.sha256)) { saved.push({ recording: r, evidence: "handed to the project command (recovery ledger)" }); continue; }
    // Two runtime files with the same bytes are one recording: hand it over once.
    if (seen.has(r.sha256)) { saved.push({ recording: r, evidence: "duplicate of another runtime file" }); continue; }
    seen.add(r.sha256);
    unsaved.push(r);
  }
  return { top, unsaved, saved, index };
}

/** Where a kind goes on this project: its command key, or the built-in target. */
function routeOf(cfg: CopilotConfig, kind: RecordingKind): string {
  const command = kind === "dictation" ? cfg.copilot.dictationHandoverCommand : cfg.copilot.handoverCommand;
  return command ? (kind === "dictation" ? "copilot.dictationHandoverCommand" : "copilot.handoverCommand") : `${DEFAULT_TARGET_DIR}/`;
}

/**
 * The readable artifacts for a recording: reused when they exist and are at least as new as
 * the raw file (a live-named `transcript.jsonl` is rewritten by the next capture, and a stale
 * `.md` beside it would describe a different meeting), otherwise stitched now.
 */
function derivedFor(cfg: CopilotConfig, r: Recording): { markdown?: string; structured?: string } {
  const paths = artifactPaths(r.path);
  try {
    const rawTime = statSync(r.path).mtimeMs;
    if (existsSync(paths.markdown) && existsSync(paths.structured)
      && statSync(paths.markdown).mtimeMs >= rawTime && statSync(paths.structured).mtimeMs >= rawTime) {
      return paths;
    }
    const out = stitchFile(r.path, cfg);
    return out ? { markdown: out.markdown, structured: out.structured } : {};
  } catch (err) {
    console.error(`[set-copilot] could not stitch ${r.path} (${(err as Error).message}) — handing over the raw file alone`);
    return {};
  }
}

export type BackfillMode = "run" | "dry-run" | "check";

/**
 * `set-copilot backfill [--dry-run | --check]`. Returns the process exit code.
 *
 * `--check` is the session-start form: silent when everything is saved, one line otherwise,
 * and always 0 — a hook that fails or chatters is a hook people remove.
 */
export function runBackfill(cfg: CopilotConfig, mode: BackfillMode): number {
  const root = resolve(cfg.projectRoot);
  const scan = scanRecordings(root);
  const classified = classifyRecordings(root, scan.recordings);
  if (!classified) {
    if (mode === "check") return 0;
    console.error(`[set-copilot] backfill: ${root} is not inside a git work tree — nothing to compare against`);
    return 1;
  }
  const { top, unsaved, saved, index } = classified;
  const rel = (p: string) => relative(top, p);

  if (mode === "check") {
    if (!unsaved.length) return 0;
    const d = unsaved.filter((r) => r.kind === "dictation").length;
    const m = unsaved.length - d;
    const last = readBackfillMarker(root)?.lastRun ?? "never";
    console.log(
      `[set-copilot] ${unsaved.length} recording(s) on this machine have no saved copy in the repo ` +
      `(${d} dictation, ${m} meeting) — list: \`set-copilot backfill --dry-run\` · save: \`set-copilot backfill\` ` +
      `(last back-fill on this machine: ${last})`,
    );
    return 0;
  }

  console.log(`[set-copilot] backfill: ${scan.recordings.length} recording(s) under .set/copilot/ — ` +
    `${saved.length} saved, ${unsaved.length} unsaved` +
    (scan.live.length ? `, ${scan.live.length} live (capture running, left alone)` : "") +
    (scan.speechless ? `, ${scan.speechless} without speech (ignored)` : ""));
  for (const r of unsaved) {
    console.log(`  ${mode === "dry-run" ? "would save" : "saving"}  ${r.kind.padEnd(9)} ${localDate(r.recordedAt)}  ` +
      `${String(r.lines).padStart(5)} lines  ${rel(r.path)}  → ${routeOf(cfg, r.kind)}`);
  }
  if (mode === "dry-run" || !unsaved.length) return 0;

  const handedOver: BackfillMarker["handedOver"] = [];
  const written: string[] = [];
  let failed = 0;
  for (const r of unsaved) {
    const derived = derivedFor(cfg, r);
    const out: HandoverOutcome = runRecordingHandover(
      cfg, { archived: r.path, ...derived }, r.kind, { backfill: true, runtimeDir: dirname(r.path), index },
    );
    const ok = out.via === "command" ? out.ok : !out.error && !out.skipped;
    if (!ok) failed++;
    if (out.via === "default") written.push(...out.written);
    handedOver.push({
      source: rel(r.path), sha256: r.sha256, kind: r.kind, via: out.via, ok,
      ...(out.via === "default" && out.written.length ? { targets: out.written.map(rel) } : {}),
    });
  }
  writeBackfillMarker(root, { lastRun: new Date().toISOString(), projectRoot: root, handedOver });

  console.log(`\n[set-copilot] backfill: handed over ${unsaved.length - failed} of ${unsaved.length}` +
    (failed ? ` — ${failed} failed (see above; they stay unsaved and the next run retries them)` : ""));
  if (written.length) console.log(`[set-copilot] Nothing was committed. To commit the built-in target's files:\n  ${gitAddLine(top, written)}`);
  if (handedOver.some((h) => h.via === "command")) {
    console.log("[set-copilot] A project command handled some recordings — review what it reported above and `git status` before committing.");
  }
  return failed ? 1 : 0;
}
