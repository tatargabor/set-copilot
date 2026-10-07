/**
 * Where a recording is persisted, and how the engine knows it already was (recording-handover).
 *
 * A recording born in `.set/copilot/<session>/` is gitignored runtime state: a worktree swap, a
 * cleanup or a new machine removes it without a trace. Measured 2026-10-07 on one machine: 15
 * dictations in one project and 14 meeting transcripts in another had no copy anywhere in their
 * repositories. This module holds the three facts every path that persists a recording needs:
 *
 * - **Identity is content, never a name.** A recording is its raw bytes' SHA-256 — the same
 *   rule `recovery-ledger` follows, for the same reasons: the handover renames what it archives,
 *   and recordings get copied under other names by projects' own scripts. Comparing against the
 *   work tree is bounded by size: only files of the same byte length are hashed, so the cost is
 *   the recordings', not the repository's.
 * - **The built-in target** (`docs/inputs/copilot/`) for a kind with no project command, so a
 *   project that configured nothing still keeps what was said. Raw copy + readable `.md` +
 *   stitched `.jsonl` side by side: a text search must find the recording wherever it lands.
 * - **A record of command hand-offs.** A project command may store a recording in a shape the
 *   engine cannot recognise (a Markdown note with frontmatter, say), so "a byte copy exists"
 *   cannot be the only evidence. A successful (exit 0) command hand-off is recorded as a
 *   `handover` step in the project's recovery ledger — gitignored runtime state, per machine.
 *
 * Nothing here stages or commits. The engine writes files; a human (or a session) commits them.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

import type { CopilotConfig } from "./config.js";
import { userConfigDir } from "./config.js";
import { appendEntry, ledgerPath, makeEntry, readLedger } from "./recovery-ledger.js";

export type RecordingKind = "dictation" | "meeting";

/** The files a hand-off is about. `archived` is the raw recording; the other two when produced. */
export interface RecordingPaths {
  archived: string;
  markdown?: string;
  structured?: string;
}

/** Where the built-in target writes, relative to the work tree's top level. */
export const DEFAULT_TARGET_DIR = join("docs", "inputs", "copilot");

/** `dictation-….jsonl` / `dictation.jsonl` is a dictation; every `transcript*` is a meeting. */
export function kindOf(path: string): RecordingKind {
  return basename(path).startsWith("dictation") ? "dictation" : "meeting";
}

/** Does a raw transcript hold at least one line of speech? Unparseable lines do not count. */
export function hasSpeech(raw: string): boolean {
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as { text?: unknown };
      if (typeof o.text === "string" && o.text.trim()) return true;
    } catch { /* not speech we can vouch for */ }
  }
  return false;
}

/** SHA-256 of a file's bytes. */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * When the recording was made, as well as the files tell. An archive's name carries the UTC
 * moment it was handed over (`…-2026-10-05T17-27-54-794Z.jsonl`); a live-named file has only
 * its mtime. The transcript's own `ts` values are offsets from the capture's start, not clock
 * times, so they cannot answer this.
 */
export function recordedAt(path: string): Date {
  const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(basename(path));
  if (m) {
    const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  try { return statSync(path).mtime; } catch { return new Date(); }
}

/** `YYYY-MM-DD` in local time — the date a person would file the recording under. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
  return { ok: !r.error && r.status === 0, out: r.stdout ?? "" };
}

/** The git work tree containing `dir`, or null outside one (or without git). */
export function gitToplevel(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const r = git(dir, ["rev-parse", "--show-toplevel"]);
  return r.ok && r.out.trim() ? resolve(r.out.trim()) : null;
}

/**
 * The work tree's content, indexed for "is this exact recording already here?".
 *
 * Covers tracked files and untracked files git does not ignore (a copy written by the previous
 * run but not committed yet must count, or a second run duplicates it), plus everything under
 * the built-in target dir regardless of ignore rules — a project that ignores `docs/inputs/`
 * would otherwise get a fresh duplicate on every stop. Sizes are read up front; a file is hashed
 * only when a recording of exactly its size asks, and each hash is computed once.
 */
export class ContentIndex {
  private readonly bySize = new Map<number, string[]>();
  private readonly hashes = new Map<string, string>();

  constructor(readonly top: string) {
    const listed = git(top, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    const rels = new Set(listed.ok ? listed.out.split("\0").filter(Boolean) : []);
    for (const rel of walkFiles(join(top, DEFAULT_TARGET_DIR), 2)) rels.add(relative(top, rel));
    for (const rel of rels) {
      // Runtime state is never a "saved copy": in a project that forgot to ignore `.set/`, the
      // archive itself would otherwise match itself, and nothing would ever be saved.
      if (isRuntimePath(rel)) continue;
      try {
        const st = statSync(join(top, rel));
        if (st.isFile()) this.addPath(rel, st.size);
      } catch { /* deleted from the work tree but still in the index: not present */ }
    }
  }

  private addPath(rel: string, size: number): void {
    const list = this.bySize.get(size);
    if (list) { if (!list.includes(rel)) list.push(rel); } else this.bySize.set(size, [rel]);
  }

  /** A work-tree path (relative to `top`) whose bytes hash to `sha256`, or null. */
  find(sha256: string, size: number): string | null {
    for (const rel of this.bySize.get(size) ?? []) {
      let h = this.hashes.get(rel);
      if (h === undefined) {
        try { h = sha256File(join(this.top, rel)); } catch { continue; }
        this.hashes.set(rel, h);
      }
      if (h === sha256) return rel;
    }
    return null;
  }

  /** Record a file this run just wrote, so the same content later in the run is a duplicate. */
  add(rel: string, sha256: string, size: number): void {
    this.addPath(rel, size);
    this.hashes.set(rel, sha256);
  }
}

/** Is a work-tree-relative path inside a `.set/` runtime tree? */
export function isRuntimePath(rel: string): boolean {
  return rel.split(/[\\/]/).includes(".set");
}

/** Regular files under `dir`, to `depth` directory levels (0 = `dir` itself only). */
export function walkFiles(dir: string, depth: number): string[] {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isFile()) out.push(p);
    else if (e.isDirectory() && depth > 0) out.push(...walkFiles(p, depth - 1));
  }
  return out;
}

// ---- the hand-off record and the back-fill marker ----------------------------

/**
 * Record a hand-off in the project's recovery ledger (`.set/copilot/recovery-log.jsonl`), as a
 * `handover` step. One content-identity ledger, not two: the recovery ledger already keys every
 * transcript by its SHA-256 and lives where every machine-local fact about a project's
 * recordings lives — beside the runtime dirs, gitignored with them. `handover` is engine-owned:
 * it is not a step `recovery claim/mark` accepts (`RECOVERY_STEPS`). A ledger write never fails
 * a hand-off: the ledger is advisory, the files are the evidence.
 */
export function recordHandover(
  projectRoot: string,
  sha256: string,
  source: string,
  outcome: { via: "command" | "default"; kind: RecordingKind; key?: string; targets?: string[]; existing?: string; backfill?: boolean },
): void {
  try {
    appendEntry(recoveryLedgerPath(projectRoot), makeEntry(sha256, "handover", "done", { path: source, outcome }));
  } catch (err) {
    console.error(`[set-copilot] could not record the hand-off in ${recoveryLedgerPath(projectRoot)}: ${(err as Error).message}`);
  }
}

/** The SHA-256s handed to a project command that exited 0 — back-fill's second kind of evidence. */
export function commandHandedOver(projectRoot: string): Set<string> {
  const out = new Set<string>();
  for (const e of readLedger(recoveryLedgerPath(projectRoot))) {
    if (e.step === "handover" && e.state === "done" && (e.outcome as { via?: unknown } | undefined)?.via === "command") {
      out.add(e.fingerprint);
    }
  }
  return out;
}

function recoveryLedgerPath(projectRoot: string): string {
  return ledgerPath({ projectRoot } as CopilotConfig);
}

/** Where back-fill records its last run: beside the ledger, machine-local, never tracked. */
export function backfillMarkerPath(projectRoot: string): string {
  return join(resolve(projectRoot), ".set", "copilot", "backfill-last.json");
}

/** What the marker records about the last back-fill run on this machine. */
export interface BackfillMarker {
  lastRun: string;
  projectRoot: string;
  handedOver: { source: string; sha256: string; kind: RecordingKind; via: "command" | "default"; ok: boolean; targets?: string[] }[];
}

export function readBackfillMarker(projectRoot: string): BackfillMarker | null {
  try {
    return JSON.parse(readFileSync(backfillMarkerPath(projectRoot), "utf-8")) as BackfillMarker;
  } catch { return null; }
}

export function writeBackfillMarker(projectRoot: string, marker: BackfillMarker): void {
  const path = backfillMarkerPath(projectRoot);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`);
}

// ---- the built-in target ----------------------------------------------------

export interface DefaultTargetResult {
  /** Absolute paths written (raw first). Empty when skipped. */
  written: string[];
  /** The work-tree path (relative to `top`) of a byte-identical copy that made it skip. */
  existing?: string;
  /** Why nothing was written, when not because of `existing`. */
  skipped?: string;
  /** The work tree's top level, when there is one. */
  top?: string;
}

/** Paths under the target dir in a git tree-ish, relative to the top level. Missing ref → empty. */
function treeNames(top: string, ref: string): Set<string> {
  const r = git(top, ["ls-tree", "-r", "--name-only", ref, "--", DEFAULT_TARGET_DIR.split(sep).join("/")]);
  return new Set(r.ok ? r.out.split("\n").filter(Boolean) : []);
}

/**
 * The base name for a recording: `<date>-<kind>-part<N>-<sha8>`.
 *
 * `N` orders the day's recordings: the lowest number not yet used by any name of that date and
 * kind — on disk, in `HEAD`, or in the current branch's upstream tree, read as it already is
 * locally (a stop must not wait on the network, so there is no fetch). The content hash makes
 * the name unique by construction: the repository lives on several machines, and two machines
 * that each saved a different recording as `part1` before pulling would otherwise meet in an
 * add/add conflict — the cross-machine git conflict this whole change exists to remove (a
 * consumer script that numbered parts locally hit exactly that, 2026-10-07). With the hash they
 * merge cleanly as two `part1`s, and nothing is lost.
 */
export function targetBase(top: string, date: string, kind: RecordingKind, sha256: string): string {
  const used = treeNames(top, "HEAD");
  const upstream = git(top, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.ok && upstream.out.trim()) for (const n of treeNames(top, upstream.out.trim())) used.add(n);
  const dir = join(top, DEFAULT_TARGET_DIR);
  for (const f of walkFiles(dir, 0)) used.add(basename(f));
  const parts = new Set<number>();
  const re = new RegExp(`^${date}-${kind}-part(\\d+)(?:[-.]|$)`);
  for (const name of used) {
    const m = re.exec(basename(name));
    if (m) parts.add(Number(m[1]));
  }
  let n = 1;
  while (parts.has(n)) n++;
  return join(dir, `${date}-${kind}-part${n}-${sha256.slice(0, 8)}`);
}

/** Copy `src` to `dest` through a temporary name, so an interrupted copy never sits under the final name. */
function copyAtomic(src: string, dest: string): void {
  const tmp = `${dest}.tmp-${process.pid}`;
  copyFileSync(src, tmp);
  renameSync(tmp, dest);
}

/**
 * Copy a recording into `docs/inputs/copilot/` of the work tree containing `projectRoot`.
 *
 * Skipped when a byte-identical copy of the raw file is already anywhere in the work tree
 * (`existing`), outside a git work tree (`skipped`) — a stop run from `~` must not grow a
 * `~/docs/` — and when the recording holds no speech (a `/ds` … `/dd` with nothing said). Never stages, never commits. Throws only on a real I/O failure, which the caller
 * reports without failing the stop.
 */
export function persistToDefaultTarget(
  projectRoot: string,
  paths: RecordingPaths,
  kind: RecordingKind,
  index?: ContentIndex,
): DefaultTargetResult {
  const top = gitToplevel(projectRoot);
  if (!top) return { written: [], skipped: "not inside a git work tree" };
  const idx = index && index.top === top ? index : new ContentIndex(top);
  const size = statSync(paths.archived).size;
  const sha = sha256File(paths.archived);
  const existing = idx.find(sha, size);
  if (existing) return { written: [], existing, top };

  if (!hasSpeech(readFileSync(paths.archived, "utf-8"))) return { written: [], skipped: "nothing was said", top };

  mkdirSync(join(top, DEFAULT_TARGET_DIR), { recursive: true });
  const base = targetBase(top, localDate(recordedAt(paths.archived)), kind, sha);
  const written: string[] = [];
  copyAtomic(paths.archived, `${base}.jsonl`);
  written.push(`${base}.jsonl`);
  idx.add(relative(top, `${base}.jsonl`), sha, size);
  if (paths.markdown && existsSync(paths.markdown)) {
    copyAtomic(paths.markdown, `${base}.md`);
    written.push(`${base}.md`);
  }
  if (paths.structured && existsSync(paths.structured)) {
    copyAtomic(paths.structured, `${base}-stitched.jsonl`);
    written.push(`${base}-stitched.jsonl`);
  }
  return { written, top };
}

/** `git add -- <paths>` for the files a run wrote, relative to the top level, quoted for a shell. */
export function gitAddLine(top: string, files: string[]): string {
  const q = (s: string) => (/^[\w./@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return `git -C ${q(top)} add -- ${files.map((f) => q(relative(top, f))).join(" ")}`;
}

// ---- the default-target stand-down policy (default-target-stands-down-on-public) ------------

/**
 * Hosting hosts whose repositories are PUBLIC unless the operator says otherwise. Domain-
 * neutral internet taxonomy, deliberately an engine constant and not config: a list that
 * defaults a safety behaviour must not be silently per-project (`wall.redaction`'s posture).
 * A remote host matches when it EQUALS an entry or is one of its subdomains — `git.sr.ht`
 * matches `sr.ht` (no sourcehut remote ever appears at the apex), and a dedicated GitHub
 * Enterprise host matches `github.com`, which suppresses it: the wrong direction there is
 * withheld, never published, and the cache mark or `"on"` answers it.
 */
export const PUBLIC_HOSTS = [
  "github.com", "gitlab.com", "codeberg.org", "bitbucket.org", "sr.ht", "framagit.org", "gitea.com",
];

/** The host of a git remote URL, or null when the URL names no host. */
export function parseRemoteHost(url: string): string | null {
  const s = url.trim();
  // scp-like `git@host:path` — no scheme, one colon after the host.
  const scp = /^[^@/]+@([^:/]+):/.exec(s);
  if (scp) return scp[1].toLowerCase();
  // `scheme://[user@]host[:port]/path`
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/?#]+)/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}

/** True when `host` equals a listed public host or is one of its subdomains. */
export function hostIsPublic(host: string): boolean {
  const h = host.toLowerCase();
  return PUBLIC_HOSTS.some((p) => h === p || h.endsWith(`.${p}`));
}

/** `repo-visibility.json` beside the user config — the `projects.json` precedent. */
export function repoVisibilityCachePath(): string {
  return join(userConfigDir(), "repo-visibility.json");
}

/**
 * The cache's marks, keyed by canonical work-tree top. Advisory: absent, unreadable or corrupt
 * reads as no marks — a hand-edited file must not be able to fail a stop. Only `"private"` is
 * ever consulted.
 */
export function loadVisibilityMarks(): Record<string, string> {
  try {
    const o = JSON.parse(readFileSync(repoVisibilityCachePath(), "utf-8")) as unknown;
    if (typeof o === "object" && o !== null && !Array.isArray(o)) {
      return Object.fromEntries(
        Object.entries(o as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
    }
    console.warn(`[set-copilot] ignoring malformed ${repoVisibilityCachePath()} — expected an object`);
    return {};
  } catch {
    return {};
  }
}

/** The inputs the decision reads, so tests can inject both. */
export interface PolicyIo {
  remoteUrls(top: string): string[];
  visibilityMarks(): Record<string, string>;
}

export function realPolicyIo(): PolicyIo {
  return {
    remoteUrls(top) {
      const r = git(top, ["remote", "-v"]);
      if (!r.ok) return [];
      // `origin\tgit@github.com:owner/repo.git (fetch)` — the URL is the second column.
      return r.out.split("\n").map((l) => l.split("\t")[1]?.replace(/ \(fetch\)$| \(push\)$/, "").trim() ?? "").filter(Boolean);
    },
    visibilityMarks: loadVisibilityMarks,
  };
}

/**
 * Why the built-in target stands down for this work tree, or undefined when it may run.
 *
 * Pure over the injected I/O. `"on"` never suppresses; `"off"` always does; `"auto"` suppresses
 * iff a remote sits on a public host and the cache does not mark the work tree `private`. The
 * cache key is the CANONICAL top (`realpathSync` — the `canonicalProjectPath` precedent), so
 * the path the operator knows, possibly behind a symlink, is the key that matches.
 */
export function defaultHandoverSuppressed(cfg: CopilotConfig, top: string, io: PolicyIo = realPolicyIo()): string | undefined {
  const mode = cfg.copilot?.defaultHandover ?? "auto";
  if (mode === "on") return undefined;
  if (mode === "off") return `copilot.defaultHandover: "off"`;
  const canonical = (() => { try { return realpathSync(top); } catch { return resolve(top); } })();
  const marks = io.visibilityMarks();
  if (marks[canonical] === "private" || marks[resolve(top)] === "private") return undefined;
  for (const url of io.remoteUrls(top)) {
    const host = parseRemoteHost(url);
    if (host && hostIsPublic(host)) return `public remote: ${host}`;
  }
  return undefined;
}
