/**
 * Runtime-dir ownership.
 *
 * These tests are the guard on the highest-consequence rule in the capture path: a
 * mistake here orphans a live recording (it keeps going, nothing can stop it) or
 * destroys a transcript nobody has read yet. Both have happened in the field, which
 * is why the rule is one implementation and why each of its four states is named.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  archivePrevious, capturePidPath, captureAlive, claimRuntimeDir, livePid, RuntimeDirBusyError,
} from "./runtime-dir.js";

let dir: string;
let output: string;
const quiet = (): void => {};

/** A PID that is certainly not running. Chosen high and checked, never assumed. */
function deadPid(): number {
  for (let pid = 900_000; pid < 900_100; pid++) {
    try { process.kill(pid, 0); } catch { return pid; }
  }
  throw new Error("no dead pid available");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "set-copilot-rtdir-"));
  output = join(dir, "transcript.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("livePid", () => {
  it("reports null for an absent PID file", () => {
    expect(livePid(capturePidPath(dir))).toBeNull();
  });

  it("reports null for an unparseable PID file rather than throwing", () => {
    writeFileSync(capturePidPath(dir), "not-a-pid");
    expect(livePid(capturePidPath(dir))).toBeNull();
  });

  it("reports null for a stale PID file — a leftover must never lock the dir forever", () => {
    writeFileSync(capturePidPath(dir), String(deadPid()));
    expect(livePid(capturePidPath(dir))).toBeNull();
  });

  it("reports the pid of a live owner", () => {
    writeFileSync(capturePidPath(dir), String(process.pid));
    expect(livePid(capturePidPath(dir))).toBe(process.pid);
  });
});

describe("captureAlive", () => {
  it("is false on an unclaimed dir and true while a claim is held", () => {
    expect(captureAlive(dir)).toBe(false);
    const claim = claimRuntimeDir({ runtimeDir: dir, output, log: quiet });
    expect(captureAlive(dir)).toBe(true);
    claim.release();
    expect(captureAlive(dir)).toBe(false);
  });
});

describe("archivePrevious", () => {
  it("does nothing when there is no transcript", () => {
    expect(archivePrevious(output, quiet)).toBeNull();
  });

  it("does nothing when the transcript is empty — an empty file is not somebody's meeting", () => {
    writeFileSync(output, "");
    expect(archivePrevious(output, quiet)).toBeNull();
    expect(existsSync(output)).toBe(true);
  });

  it("renames a non-empty transcript aside, preserving its contents", () => {
    writeFileSync(output, '{"text":"kept"}\n');
    const archived = archivePrevious(output, quiet);
    expect(archived).not.toBeNull();
    expect(existsSync(output)).toBe(false);
    expect(readFileSync(archived as string, "utf-8")).toBe('{"text":"kept"}\n');
  });
});

describe("claimRuntimeDir", () => {
  it("records the state consumers read: pid, output path, and a reset offset", () => {
    const claim = claimRuntimeDir({ runtimeDir: dir, output, pid: process.pid, log: quiet });
    expect(readFileSync(claim.pidFile, "utf-8")).toBe(String(process.pid));
    expect(readFileSync(join(dir, "capture.output"), "utf-8")).toBe(output);
    expect(readFileSync(join(dir, "poll-offset"), "utf-8")).toBe("0");
    expect(existsSync(output)).toBe(true);
    claim.release();
  });

  it("refuses a dir with a live owner", () => {
    writeFileSync(capturePidPath(dir), String(process.pid));
    expect(() => claimRuntimeDir({ runtimeDir: dir, output, log: quiet }))
      .toThrow(RuntimeDirBusyError);
  });

  it("leaves the live owner's transcript untouched when it refuses", () => {
    // The load-bearing half of the refusal: a rejected claim must be a no-op on disk,
    // or refusing to start would still have destroyed the recording it protected.
    writeFileSync(output, '{"text":"a live meeting"}\n');
    writeFileSync(capturePidPath(dir), String(process.pid));
    expect(() => claimRuntimeDir({ runtimeDir: dir, output, log: quiet })).toThrow();
    expect(readFileSync(output, "utf-8")).toBe('{"text":"a live meeting"}\n');
    expect(existsSync(join(dir, "poll-offset"))).toBe(false);
  });

  it("names the owning pid in the refusal, so an operator can act on it", () => {
    writeFileSync(capturePidPath(dir), String(process.pid));
    try {
      claimRuntimeDir({ runtimeDir: dir, output, log: quiet });
      expect.unreachable("claim should have been refused");
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeDirBusyError);
      expect((err as RuntimeDirBusyError).pid).toBe(process.pid);
      expect((err as Error).message).toContain(String(process.pid));
    }
  });

  it("reclaims a stale PID file", () => {
    writeFileSync(capturePidPath(dir), String(deadPid()));
    const claim = claimRuntimeDir({ runtimeDir: dir, output, pid: process.pid, log: quiet });
    expect(readFileSync(claim.pidFile, "utf-8")).toBe(String(process.pid));
    claim.release();
  });

  it("archives an unconsumed transcript instead of truncating it", () => {
    writeFileSync(output, '{"text":"never handed over"}\n');
    const claim = claimRuntimeDir({ runtimeDir: dir, output, log: quiet });
    expect(claim.archived).not.toBeNull();
    expect(readFileSync(claim.archived as string, "utf-8")).toBe('{"text":"never handed over"}\n');
    expect(readFileSync(output, "utf-8")).toBe("");
    claim.release();
  });

  it("releases idempotently — a double release must not throw", () => {
    const claim = claimRuntimeDir({ runtimeDir: dir, output, log: quiet });
    claim.release();
    claim.release();
    expect(existsSync(claim.pidFile)).toBe(false);
  });

  it("lets a second owner claim the dir after the first releases", () => {
    const first = claimRuntimeDir({ runtimeDir: dir, output, log: quiet });
    first.release();
    const second = claimRuntimeDir({ runtimeDir: dir, output, log: quiet });
    expect(existsSync(second.pidFile)).toBe(true);
    second.release();
  });
});
