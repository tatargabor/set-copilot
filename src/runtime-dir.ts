/**
 * Runtime-dir ownership — who owns a capture directory, and how that is claimed
 * and released.
 *
 * A runtime dir holds one recording's whole state: the transcript, `capture.pid`,
 * `capture.output`, and `poll-offset`. Exactly one process may own it at a time,
 * because the alternative is concrete and bad: a second writer overwrites the PID
 * file and orphans the first process, which keeps recording with nothing able to
 * stop it.
 *
 * This module exists because that rule had four independent implementations
 * (`capture.ts`, `poll.ts`, and twice in `cli.ts`) before `set-copilot replay`
 * became a second legitimate owner. Two implementations of "who owns this dir" is
 * how the first one gets a fix the second one never receives — so the rule lives
 * here once and every owner and observer calls it.
 *
 * The PID file is named `capture.pid` whoever writes it. A replay is a capture as
 * far as every consumer is concerned; giving it its own file name would mean
 * teaching `poll` about replay, and the whole value of the replay path is that no
 * consumer knows it exists.
 */

import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** The capture PID file for a runtime dir. One name, whoever owns it. */
export function capturePidPath(runtimeDir: string): string {
  return join(runtimeDir, "capture.pid");
}

/**
 * PID of the process owning `pidFile`, or null when the file is absent, unparseable,
 * or names a process that is gone.
 *
 * A leftover PID file is not an error: a capture killed with SIGKILL, or a machine
 * that rebooted, leaves one behind. Reporting "gone" is what lets the next owner
 * reclaim the dir instead of being locked out of it forever.
 */
export function livePid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  if (!Number.isFinite(pid)) return null;
  try {
    process.kill(pid, 0); // signal 0 = existence check, sends nothing
    return pid;
  } catch {
    return null; // process is gone — the PID file is a leftover
  }
}

/** Is someone recording into this runtime dir right now? The consumers' liveness check. */
export function captureAlive(runtimeDir: string): boolean {
  return livePid(capturePidPath(runtimeDir)) !== null;
}

/**
 * Move a non-empty transcript to `<name>-<timestamp>.jsonl`.
 *
 * Rotate, never truncate: an unconsumed transcript is somebody's meeting, and the
 * one at this path was measured in the field to be an entire 539-line session that
 * nobody had handed over. The configured output path keeps naming the current
 * recording; the previous one stays readable next to it.
 *
 * Returns the archive path, or null when there was nothing to archive.
 */
export function archivePrevious(output: string, log: (msg: string) => void = console.log): string | null {
  if (!existsSync(output) || statSync(output).size === 0) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archived = `${output.replace(/\.jsonl$/, "")}-${stamp}.jsonl`;
  renameSync(output, archived);
  log(`[set-copilot] Previous transcript archived: ${archived}`);
  return archived;
}

export interface ClaimOptions {
  /** The runtime dir to take ownership of. */
  runtimeDir: string;
  /** The transcript this owner will write. */
  output: string;
  /** PID to record. Defaults to this process — an argument so the claim is testable. */
  pid?: number;
  log?: (msg: string) => void;
}

/** A held claim. `release()` gives the dir back; calling it twice is harmless. */
export interface RuntimeClaim {
  pidFile: string;
  output: string;
  /** The previous transcript that was archived on claim, if any. */
  archived: string | null;
  release(): void;
}

/** Thrown when the runtime dir already has a live owner. Carries the PID so a caller can name it. */
export class RuntimeDirBusyError extends Error {
  constructor(readonly pid: number, readonly runtimeDir: string) {
    super(`A capture is already running (pid ${pid}) in ${runtimeDir} — run \`set-copilot stop\` first.`);
    this.name = "RuntimeDirBusyError";
  }
}

/**
 * Take ownership of a runtime dir: refuse if it is busy, reclaim it if the previous
 * owner is gone, archive an unconsumed transcript, and record the state consumers
 * read (`capture.pid`, `capture.output`, a reset `poll-offset`).
 *
 * The order matters. The busy check comes first, before anything on disk is touched,
 * so a refused claim leaves the live owner's transcript exactly as it was.
 *
 * Throws `RuntimeDirBusyError` rather than exiting, so a caller decides how to fail.
 */
export function claimRuntimeDir(opts: ClaimOptions): RuntimeClaim {
  const { runtimeDir, output } = opts;
  const pid = opts.pid ?? process.pid;
  const log = opts.log ?? console.log;

  const pidFile = capturePidPath(runtimeDir);

  // Refuse BEFORE touching anything: a refused claim must be a no-op on disk.
  const alive = livePid(pidFile);
  if (alive !== null) throw new RuntimeDirBusyError(alive, runtimeDir);

  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(dirname(output), { recursive: true });

  const archived = archivePrevious(output, log);
  closeSync(openSync(output, "a")); // create the fresh transcript

  writeFileSync(pidFile, String(pid));
  // Which file this owner writes: `stop --print` and `status` need it, and only the
  // owner knows whether this run is dictation, meeting, or replay.
  writeFileSync(join(runtimeDir, "capture.output"), output);
  // Reset the poll offset so a consumer reads from the top of the fresh file.
  writeFileSync(join(runtimeDir, "poll-offset"), "0");

  let released = false;
  return {
    pidFile,
    output,
    archived,
    release(): void {
      if (released) return;
      released = true;
      try { rmSync(pidFile); } catch { /* already gone */ }
    },
  };
}
