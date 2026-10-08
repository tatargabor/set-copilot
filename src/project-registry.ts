import { existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync, closeSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { userConfigDir } from "./config.js";

/**
 * The per-user project registry — the launcher's answer to "which project?".
 *
 * Advisory by construction, like the recovery ledger: a missing or corrupt
 * registry reads as empty with a warning, and no verb fails because of
 * registry state. A project never needs registration — a directory is always
 * usable directly. The registry stores IDENTITY only (path, name, timestamps);
 * knowledge sources and behavior stay in each project's own
 * set-copilot.config.json, where every other per-project fact lives.
 */

export interface ProjectRecord {
  /** Canonical absolute path of the project directory */
  path: string;
  /** Display name — defaults to the directory basename */
  name: string;
  addedAt: string;
  /** ISO timestamp of the last launch via `set-copilot meeting`; null until then */
  lastUsedAt: string | null;
}

export interface ProjectRegistry {
  version: 1;
  projects: ProjectRecord[];
}

export function registryPath(): string {
  return join(userConfigDir(), "projects.json");
}

export function emptyRegistry(): ProjectRegistry {
  return { version: 1, projects: [] };
}

/**
 * Load the registry, degrading to empty. A registry that could break a meeting
 * is a registry that shouldn't exist — the file is a convenience, so its
 * failure modes are a warning on stderr and a fresh start, never an error.
 */
export function loadRegistry(): ProjectRegistry {
  const path = registryPath();
  if (!existsSync(path)) return emptyRegistry();
  try {
    const reg = JSON.parse(readFileSync(path, "utf-8")) as ProjectRegistry;
    if (!Array.isArray(reg.projects)) throw new Error("missing projects array");
    return {
      version: 1,
      projects: reg.projects.filter(
        (p): p is ProjectRecord =>
          !!p && typeof p.path === "string" && typeof p.name === "string",
      ),
    };
  } catch (err) {
    console.warn(
      `[set-copilot] ${path} is unreadable (${err instanceof Error ? err.message : err}) — treating the registry as empty; it will be rewritten on the next add`,
    );
    return emptyRegistry();
  }
}

/** Write through a temp file + rename, so a crash mid-write cannot truncate the registry. */
export function saveRegistry(reg: ProjectRegistry): void {
  const path = registryPath();
  mkdirSync(userConfigDir(), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`);
  renameSync(tmp, path);
}

/**
 * Canonical form of a project path — realpath when the directory exists (this
 * is what collapses a symlink or a `..`-laden spelling onto the one record),
 * plain resolution otherwise.
 */
export function canonicalProjectPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** All records matching a name exactly or a path canonically — 0..n, so callers can disambiguate. */
export function lookupProjects(reg: ProjectRegistry, nameOrPath: string): ProjectRecord[] {
  const canonical = canonicalProjectPath(nameOrPath);
  return reg.projects.filter((p) => p.name === nameOrPath || p.path === canonical);
}

export function upsertProject(
  reg: ProjectRegistry,
  dir: string,
  name?: string,
): { record: ProjectRecord; created: boolean } {
  const path = canonicalProjectPath(dir);
  const existing = reg.projects.find((p) => p.path === path);
  if (existing) {
    if (name) existing.name = name;
    return { record: existing, created: false };
  }
  const record: ProjectRecord = {
    path,
    name: name || basename(path),
    addedAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  reg.projects.push(record);
  return { record, created: true };
}

export function removeProject(reg: ProjectRegistry, record: ProjectRecord): void {
  reg.projects = reg.projects.filter((p) => p.path !== record.path);
}

/** Record a launch. Returns false when the path is not registered (nothing to touch). */
export function touchProject(reg: ProjectRegistry, path: string, when: Date = new Date()): boolean {
  const canonical = canonicalProjectPath(path);
  const record = reg.projects.find((p) => p.path === canonical);
  if (!record) return false;
  record.lastUsedAt = when.toISOString();
  return true;
}

// ---- discovery -------------------------------------------------------------

/**
 * Minimal fs surface so discovery is unit-testable without a real tree —
 * the same seam the glob and the stitch tests use.
 */
export interface DiscoveryFs {
  listDir(dir: string): string[];
  isDirectory(path: string): boolean;
  isFile(path: string): boolean;
  mtimeMs(path: string): number;
  /** First `maxBytes` bytes of a file, read positionally (history files run to megabytes). */
  readFileHead(path: string, maxBytes: number): string;
}

export const nodeDiscoveryFs: DiscoveryFs = {
  listDir: (dir) => readdirSync(dir),
  isDirectory: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  isFile: (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
  mtimeMs: (p) => statSync(p).mtimeMs,
  readFileHead: (p, maxBytes) => {
    const fd = openSync(p, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const read = readSync(fd, buf, 0, maxBytes, 0);
      return buf.toString("utf-8", 0, read);
    } finally {
      closeSync(fd);
    }
  },
};

export const DEFAULT_SCAN_ROOTS = ["~/code", "~/src", "~/projects", "~/dev"];

/** Depth the filesystem scan descends under each root — enough for ~/code/org/repo, cheap everywhere. */
export const SCAN_DEPTH = 3;

export interface DiscoveredProject {
  path: string;
  /** Most recent evidence timestamp, when any source had one; null sorts last */
  recencyMs: number | null;
  /** Which sources knew this path — "scan", "claude-history", or both */
  sources: string[];
}

/**
 * Expand `~` and resolve scan roots, reporting which exist — the caller skips
 * missing roots without failing the scan (a stale root is a normal state on a
 * machine whose projects moved, not an error).
 */
export function expandScanRoots(
  roots: string[],
  fs: DiscoveryFs = nodeDiscoveryFs,
): { existing: string[]; missing: string[] } {
  const existing: string[] = [];
  const missing: string[] = [];
  for (const raw of roots) {
    const expanded = raw.startsWith("~") ? join(homedir(), raw.slice(1)) : raw;
    const abs = resolve(expanded);
    if (fs.isDirectory(abs)) existing.push(abs);
    else missing.push(abs);
  }
  return { existing, missing };
}

/**
 * Depth-limited sweep for git repositories under one root. A directory holding
 * `.git` (directory or file — worktrees carry a file) counts as a project and
 * is not descended into further; hidden directories and node_modules are pruned.
 */
export function scanGitRoots(root: string, depth: number, fs: DiscoveryFs = nodeDiscoveryFs): string[] {
  if (depth < 0 || !fs.isDirectory(root)) return [];
  const out: string[] = [];
  for (const entry of fs.listDir(root)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(root, entry);
    if (!fs.isDirectory(full)) continue;
    if (fs.isFile(join(full, ".git")) || fs.isDirectory(join(full, ".git"))) {
      out.push(full);
      continue;
    }
    out.push(...scanGitRoots(full, depth - 1, fs));
  }
  return out;
}

export const CLAUDE_HISTORY_DIR = join(homedir(), ".claude", "projects");
/**
 * How much of a session file to scan for its `cwd`. The slug directory names are
 * a lossy encoding (`/` and `.` both become `-`), so the cwd is read out of the
 * session JSONL instead; most entries carry it, and the cap keeps a huge session
 * from turning the scan into a full-file read.
 */
export const CLAUDE_HISTORY_CAP_BYTES = 512 * 1024;

const CWD_IN_LINE = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;

export interface ClaudeHistoryEntry {
  path: string;
  recencyMs: number;
}

/**
 * Read candidate project directories out of Claude Code's per-user project
 * history: one directory per project the user has opened, newest session file
 * carrying the real path. Entries whose cwd is missing, undecodable, or no
 * longer on disk are skipped — the history is evidence, not authority.
 */
export function readClaudeHistoryProjects(
  dir: string,
  fs: DiscoveryFs = nodeDiscoveryFs,
): ClaudeHistoryEntry[] {
  if (!fs.isDirectory(dir)) return [];
  const out: ClaudeHistoryEntry[] = [];
  let slugDirs: string[];
  try {
    slugDirs = fs.listDir(dir);
  } catch {
    return out;
  }
  for (const slug of slugDirs) {
    const slugDir = join(dir, slug);
    if (!fs.isDirectory(slugDir)) continue;
    let files: string[];
    try {
      files = fs.listDir(slugDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    if (!files.length) continue;
    let newest = files[0];
    for (const f of files.slice(1)) {
      if (fs.mtimeMs(join(slugDir, f)) > fs.mtimeMs(join(slugDir, newest))) newest = f;
    }
    const newestPath = join(slugDir, newest);
    try {
      const head = fs.readFileHead(newestPath, CLAUDE_HISTORY_CAP_BYTES);
      const m = CWD_IN_LINE.exec(head);
      if (!m) continue;
      const cwd = JSON.parse(`"${m[1]}"`) as string;
      if (typeof cwd === "string" && fs.isDirectory(cwd)) {
        out.push({ path: cwd, recencyMs: fs.mtimeMs(newestPath) });
      }
    } catch {
      continue; // unreadable file, invalid escape — one project less, never a failure
    }
  }
  return out;
}

/**
 * Collapse the sources into one list: dedup by path, most recent first, never-
 * used last, ties alphabetical so output is stable across runs.
 */
export function mergeDiscovered(
  groups: { path: string; recencyMs: number | null; source: string }[],
): DiscoveredProject[] {
  const byPath = new Map<string, DiscoveredProject>();
  for (const g of groups) {
    const existing = byPath.get(g.path);
    if (existing) {
      if (!existing.sources.includes(g.source)) existing.sources.push(g.source);
      if (g.recencyMs !== null && (existing.recencyMs === null || g.recencyMs > existing.recencyMs)) {
        existing.recencyMs = g.recencyMs;
      }
      continue;
    }
    byPath.set(g.path, { path: g.path, recencyMs: g.recencyMs, sources: [g.source] });
  }
  return [...byPath.values()].sort((a, b) => {
    if (a.recencyMs === null && b.recencyMs === null) return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    if (a.recencyMs === null) return 1;
    if (b.recencyMs === null) return -1;
    return b.recencyMs - a.recencyMs;
  });
}

/**
 * Candidate projects from both sources. Advisory end to end: a missing root or
 * an unreadable history directory shrinks the result, never throws.
 */
export function discoverProjects(
  opts: {
    roots?: string[];
    claudeProjectsDir?: string;
    depth?: number;
    fs?: DiscoveryFs;
  } = {},
): DiscoveredProject[] {
  const fs = opts.fs ?? nodeDiscoveryFs;
  const groups: { path: string; recencyMs: number | null; source: string }[] = [];
  const { existing } = expandScanRoots(opts.roots ?? DEFAULT_SCAN_ROOTS, fs);
  for (const root of existing) {
    for (const repo of scanGitRoots(root, opts.depth ?? SCAN_DEPTH, fs)) {
      groups.push({ path: repo, recencyMs: fs.mtimeMs(repo), source: "scan" });
    }
  }
  const historyDir = opts.claudeProjectsDir ?? CLAUDE_HISTORY_DIR;
  for (const entry of readClaudeHistoryProjects(historyDir, fs)) {
    groups.push({ path: entry.path, recencyMs: entry.recencyMs, source: "claude-history" });
  }
  return mergeDiscovered(groups);
}
