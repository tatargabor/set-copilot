/**
 * `mirror-follow` — the chat→wall mirror's delivery mechanism.
 *
 * It replaces a `Stop` hook, and the reason is measured. On 2026-07-29 the first report was
 * "the mirror silently stopped at 20:52:39"; the artifacts say otherwise. `wall-events.jsonl`'s
 * last write was 20:57:40 — the mirror was alive to the end — and the message it never
 * delivered passed the policy cleanly. What the timestamps show is a mechanism permanently ONE
 * MESSAGE BEHIND: the hook fires at turn end and reads the transcript then, racing the final
 * block's flush to disk (0.2 s decided it), and it takes only the turn's last text block
 * (`jq … | last`), discarding everything said mid-turn.
 *
 * The enabling fact: the session transcript is appended DURING the turn. Followed
 * continuously, the same file yields every text block at the moment it is written — no race,
 * no turn boundary, and no dependence on a hook firing. Enforcement stays structural and gets
 * stronger: it now depends on neither the model's discipline nor the harness's hooks.
 *
 * Three invariants, each from a defect in the mechanism being replaced:
 *
 * 1. **Delivery is confirmed before it is forgotten.** The hook wrote its dedup stamp BEFORE
 *    emitting, and emitted with `|| true`. A failed emit was therefore invisible *and*
 *    permanently de-duplicated — unretryable, because the stamp claimed it had gone out. Here
 *    the offset and the stamp advance only after `emitWallEvents` reports success, and a
 *    failed pass leaves both untouched so the next pass re-reads and retries.
 *
 * 2. **Replay is worse than loss, in exactly one case.** A transcript shorter than the
 *    recorded offset (truncated, rotated, replaced) resumes at EOF rather than re-delivering
 *    a session's worth of stale messages onto a live wall in front of an audience.
 *
 * 3. **Every decision is recorded.** The field failure was undiagnosable because nothing on
 *    disk distinguished "never ran" from "suppressed it". `wall-mirror.log` answers that per
 *    message, and `doctor --mirror` answers the process-level question.
 *
 * Sidechain (subagent) entries are excluded: they live in the same file, and the old `| last`
 * never noticed because it took one block per turn. A follower that emitted every block would
 * put every subagent's chatter on the wall.
 */

import { createHash } from "node:crypto";
import {
  appendFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync,
  readdirSync, renameSync, statSync, unlinkSync, watch, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { CopilotConfig } from "./config.js";
import { applyMirrorPolicy, type MirrorDecision } from "./mirror-policy.js";
import { emitWallEvents } from "./wall/emit.js";

// ---- runtime-dir files (the follower's own, alongside capture's) --------------

export const MIRROR_PID = "mirror.pid";
export const MIRROR_OFFSET = "mirror-offset";
export const MIRROR_LOG = "wall-mirror.log";
export const MIRROR_STAMP = "wall-mirror.last";
export const MIRROR_MARKER = "wall-mirror.enabled";

/** Bounded so a long session cannot fill the disk; rotated, never truncated (the wall log's rule). */
export const MIRROR_LOG_MAX_LINES = 2000;

// ---- transcript parsing (pure) ----------------------------------------------

export interface MirrorableMessage {
  /** The transcript entry's uuid — the identification the log needs to find it again. */
  uuid: string;
  timestamp: string;
  text: string;
  /** Byte offset just past this entry's line, i.e. what the read offset becomes once it is delivered. */
  endOffset: number;
}

export interface ParseResult {
  messages: MirrorableMessage[];
  /** A partial trailing line — a JSONL append is not atomic with respect to a reader. */
  carry: string;
}

/**
 * Extract the mirrorable messages from a transcript chunk.
 *
 * `baseOffset` is the absolute byte offset `chunk` starts at, so each message can carry the
 * offset that means "this one is delivered". A malformed line is skipped, never thrown on: the
 * transcript is someone else's format and a single unreadable line must not stop the mirror.
 */
export function parseMirrorables(chunk: string, carry: string, baseOffset: number): ParseResult {
  const buf = carry + chunk;
  const lines = buf.split("\n");
  const trailing = lines.pop() ?? ""; // after the last "\n": incomplete, keep for next time
  const messages: MirrorableMessage[] = [];

  // Offsets are counted from where `carry` began, which is `baseOffset - carry.length`.
  let cursor = baseOffset - Buffer.byteLength(carry, "utf-8");
  for (const line of lines) {
    cursor += Buffer.byteLength(line, "utf-8") + 1; // +1: the newline
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (e.type !== "assistant" || e.isSidechain === true) continue;
    const message = e.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b?.type !== "text" || typeof b.text !== "string" || !b.text.trim()) continue;
      messages.push({
        uuid: typeof e.uuid === "string" ? e.uuid : "?",
        timestamp: typeof e.timestamp === "string" ? e.timestamp : "",
        text: b.text,
        endOffset: cursor,
      });
    }
  }
  return { messages, carry: trailing };
}

// ---- transcript path resolution ---------------------------------------------

export interface ResolveInputs {
  /** `--transcript`: wins over everything, and is the escape hatch if the convention changes. */
  explicit?: string;
  sessionId?: string;
  /** The project dir the session runs in — the convention derives the slug from it. */
  cwd: string;
  /** Overridable for tests. */
  projectsRoot?: string;
}

export type ResolveResult =
  | { ok: true; path: string; how: "explicit" | "convention" | "glob" }
  | { ok: false; reason: string };

/** Claude Code's per-project directory name: the path with separators as dashes. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/**
 * Find the session transcript. The hook received `transcript_path` in its payload; a
 * standalone follower has to resolve it, so the order is explicit → convention → glob by
 * session id. The glob exists because the convention is harness-internal: it survives a moved
 * project or a changed slug rule, and if all three fail the error names `--transcript` rather
 * than leaving the operator to guess.
 */
export function resolveTranscriptPath(inp: ResolveInputs): ResolveResult {
  if (inp.explicit) {
    return existsSync(inp.explicit)
      ? { ok: true, path: inp.explicit, how: "explicit" }
      : { ok: false, reason: `a megadott leirat nem létezik: ${inp.explicit}` };
  }
  if (!inp.sessionId) {
    return { ok: false, reason: "nincs session id (add meg: --session <id> vagy --transcript <path>)" };
  }
  const root = inp.projectsRoot ?? join(homedir(), ".claude", "projects");
  const byConvention = join(root, projectSlug(inp.cwd), `${inp.sessionId}.jsonl`);
  if (existsSync(byConvention)) return { ok: true, path: byConvention, how: "convention" };

  // Glob by session id: the id is unique, so any project dir holding it is the right one.
  try {
    for (const dir of readdirSync(root)) {
      const candidate = join(root, dir, `${inp.sessionId}.jsonl`);
      if (existsSync(candidate)) return { ok: true, path: candidate, how: "glob" };
    }
  } catch {
    return { ok: false, reason: `nem olvasható: ${root} — add meg: --transcript <path>` };
  }
  return {
    ok: false,
    reason: `nem találom a(z) ${inp.sessionId} session leiratát (${root} alatt) — add meg: --transcript <path>`,
  };
}

// ---- offset / stamp / log ---------------------------------------------------

function readOffset(dir: string): number {
  try {
    const n = parseInt(readFileSync(join(dir, MIRROR_OFFSET), "utf-8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeOffset(dir: string, offset: number): void {
  writeFileSync(join(dir, MIRROR_OFFSET), `${offset}\n`);
}

const hashOf = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

/**
 * Append one line per considered message. The log is the deliverable, not a debug aid: it is
 * what makes "the mirror decided not to send this" distinguishable from "the mirror never
 * ran" — the distinction whose absence made the 2026-07-29 failure unattributable.
 */
export function logMirror(dir: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...fields }) + "\n";
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, MIRROR_LOG);
    if (existsSync(file)) {
      // Rotate (never truncate) once the line budget is spent, mirroring the wall event log.
      const lines = readFileSync(file, "utf-8").split("\n").length - 1;
      if (lines >= MIRROR_LOG_MAX_LINES) {
        renameSync(file, join(dir, `wall-mirror-${new Date().toISOString().replace(/[:.]/g, "-")}.log`));
      }
    }
    appendFileSync(file, line);
  } catch {
    // The log must never be the reason mirroring stops.
  }
}

/** The last emission's timestamp, for `doctor --mirror`. Null when nothing was ever emitted. */
export function lastMirrorEmission(dir: string): string | null {
  try {
    const lines = readFileSync(join(dir, MIRROR_LOG), "utf-8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]) as { decision?: string; ts?: string };
        if (e.decision === "emit" && typeof e.ts === "string") return e.ts;
      } catch { /* a corrupt line is skipped — the log is advisory */ }
    }
  } catch { /* no log yet */ }
  return null;
}

// ---- PID ownership ----------------------------------------------------------

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type PidCheck =
  | { state: "free" }
  | { state: "stale"; pid: number }
  | { state: "live"; pid: number };

/**
 * Who owns this runtime dir's mirror? A live owner means a second follower is refused — the
 * same rule as a second capture, for the same reason: overwriting the PID file would orphan a
 * process that keeps emitting with nothing able to stop it. A dead owner is reclaimed.
 */
export function checkMirrorPid(dir: string): PidCheck {
  const file = join(dir, MIRROR_PID);
  if (!existsSync(file)) return { state: "free" };
  const pid = parseInt(readFileSync(file, "utf-8").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return { state: "stale", pid: 0 };
  return processAlive(pid) ? { state: "live", pid } : { state: "stale", pid };
}

export function mirrorPid(dir: string): number | null {
  const c = checkMirrorPid(dir);
  return c.state === "live" ? c.pid : null;
}

// ---- the drain (one pass over whatever the transcript has gained) -----------

export interface DrainResult {
  considered: number;
  emitted: number;
  suppressed: number;
  /** Set when a pass stopped early: the offset was left unadvanced so the next pass retries. */
  failure?: string;
}

/** Read `[offset, size)` of a file as UTF-8, without loading the whole thing. */
function readFrom(path: string, offset: number, size: number): string {
  const length = size - offset;
  if (length <= 0) return "";
  const buf = Buffer.allocUnsafe(length);
  const fd = openSync(path, "r");
  try {
    const read = readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, read).toString("utf-8");
  } finally {
    closeSync(fd);
  }
}

export interface DrainOptions {
  transcript: string;
  /** Emit even without the wall/marker preconditions? Never true in normal operation. */
  force?: boolean;
}

/**
 * Deliver everything the transcript has gained since the recorded offset.
 *
 * Self-gating per pass (not once at startup): a wall can come up or go down mid-session, and
 * the gate has to follow it. The offset still advances while gated OFF — a message written
 * while no wall existed is not wall material later, and replaying it when a wall appears would
 * dump history onto a fresh wall.
 */
export function drainMirror(cfg: CopilotConfig, opts: DrainOptions): DrainResult {
  const dir = cfg.runtimeDir;
  const result: DrainResult = { considered: 0, emitted: 0, suppressed: 0 };

  let size: number;
  try {
    size = statSync(opts.transcript).size;
  } catch (e) {
    result.failure = `nem olvasható a leirat: ${(e as Error).message}`;
    return result;
  }

  let offset = readOffset(dir);
  if (offset > size) {
    // Truncated / rotated / replaced. Resume at EOF: replaying a whole session onto a live
    // wall in front of an audience is worse than losing the gap. The ONE place this path
    // deliberately drops content, so it says so.
    logMirror(dir, { decision: "reset", reason: "transcript shorter than offset", offset, size });
    writeOffset(dir, size);
    return result;
  }
  if (offset === size) return result;

  const gated = opts.force
    ? true
    : existsSync(join(dir, "wall.pid")) && existsSync(join(dir, MIRROR_MARKER));

  const { messages } = parseMirrorables(readFrom(opts.transcript, offset, size), "", offset);

  for (const msg of messages) {
    result.considered++;
    if (!gated) {
      // Not wall material *now*: advance past it silently rather than queueing it.
      writeOffset(dir, msg.endOffset);
      continue;
    }
    const verdict = applyMirrorPolicy(msg.text, cfg.copilot.mirror);
    if (verdict.decision !== "emit") {
      result.suppressed++;
      logMirror(dir, { decision: verdict.decision as MirrorDecision, uuid: msg.uuid, chars: msg.text.length });
      writeOffset(dir, msg.endOffset);
      continue;
    }

    // Dedup on the whole message, not per chunk: a repeat is a repeat of the message.
    const stampFile = join(dir, MIRROR_STAMP);
    const hash = hashOf(verdict.chunks.join("\n"));
    let previous = "";
    try { previous = readFileSync(stampFile, "utf-8").trim(); } catch { /* none yet */ }
    if (previous === hash) {
      logMirror(dir, { decision: "dup", uuid: msg.uuid });
      writeOffset(dir, msg.endOffset);
      continue;
    }

    const emit = emitWallEvents(
      cfg,
      verdict.chunks.map((text) => ({ category: cfg.copilot.mirror.category, zone: "both", text })),
    );
    if (emit.emitted !== verdict.chunks.length || emit.dropped.length) {
      // Neither the offset nor the stamp moves: the next pass re-reads this message and
      // retries. This is the inverse of the hook's ordering, which stamped first and
      // discarded the error — making a failed emit invisible AND unretryable.
      result.failure = emit.dropped.map((d) => d.reason).join("; ") || "az emit nem írt ki minden darabot";
      logMirror(dir, { decision: "error", uuid: msg.uuid, reason: result.failure });
      return result;
    }

    writeFileSync(stampFile, hash);
    writeOffset(dir, msg.endOffset);
    result.emitted++;
    logMirror(dir, {
      decision: "emit", uuid: msg.uuid, chunks: verdict.chunks.length,
      chars: msg.text.length, offset: msg.endOffset,
    });
  }
  return result;
}

// ---- the follower process --------------------------------------------------

/** The safety poll behind `fs.watch`, for filesystems where inotify does not fire. */
export const POLL_MS = 250;

export interface FollowOptions extends DrainOptions {
  /** Drain once and return, instead of following. Used by `stop`'s drain step. */
  once?: boolean;
}

export interface FollowHandle {
  stop(): void;
}

/**
 * Take ownership of the runtime dir and follow the transcript until stopped.
 *
 * `fs.watch` wakes on append at no polling cost; the interval re-`stat`s as a backstop. No
 * `tail -F` subprocess: this must behave identically wherever Node runs, and a subprocess
 * would add a second failure mode for no benefit.
 */
export function startMirrorFollow(cfg: CopilotConfig, opts: FollowOptions): FollowHandle {
  const dir = cfg.runtimeDir;
  mkdirSync(dir, { recursive: true });
  const pidFile = join(dir, MIRROR_PID);
  writeFileSync(pidFile, `${process.pid}\n`);

  let running = true;
  let draining = false;
  const pass = (): void => {
    if (!running || draining) return;
    draining = true;
    try {
      const r = drainMirror(cfg, opts);
      if (r.failure) console.error(`[set-copilot] mirror: ${r.failure} — újrapróbálom`);
    } catch (e) {
      // A follower that dies takes the mirror with it silently — the failure class this
      // whole change exists to end. Report and keep going.
      console.error(`[set-copilot] mirror: ${(e as Error).message}`);
      logMirror(dir, { decision: "error", reason: (e as Error).message });
    } finally {
      draining = false;
    }
  };

  pass();

  const timer = setInterval(pass, POLL_MS);
  let watcher: ReturnType<typeof watch> | null = null;
  try {
    watcher = watch(opts.transcript, () => pass());
  } catch {
    // No inotify (or the file was replaced): the interval alone is enough.
  }

  const stop = (): void => {
    if (!running) return;
    running = false;
    clearInterval(timer);
    watcher?.close();
    try { unlinkSync(pidFile); } catch { /* already gone */ }
  };
  return { stop };
}
