/**
 * Where `init` puts the skills, and how an installed skill stays identical to its source.
 *
 * `init` used to do one thing per skill: `cpSync`. That was right when the only way to get
 * the package was `npm i`, and wrong the moment the same machine also *develops* it — the
 * normal case here, where the global binary is `npm link`ed at the checkout. A copy taken
 * from a directory that keeps moving is a snapshot nothing refreshes and nothing reports.
 * Measured 2026-08-09: the installed `meeting-copilot/SKILL.md` was 16 437 B against a
 * 31 107 B source — ~15 KB, the whole mirror section, that never reached a session — while
 * two of the six skills had never been installed at all and the message named all six.
 *
 * So: **a checkout is the source, not a snapshot of it.** The mode is decided from the
 * package's own location (`.git` present → link), never from what happens to be at the
 * destination — deciding from the destination makes the mode sticky to whatever the last
 * run did, which is exactly the un-inspectable state this exists to remove.
 *
 * The planning is pure and the executing is not, deliberately: the repo's test rule is that
 * vitest covers pure logic and the CLI is verified by running it, so every judgement
 * (link/copy, archive, refuse) lives in `planSkillInstall` where a test can reach it, and
 * only `symlinkSync`/`cpSync`/`renameSync` sit outside.
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** How a skill is installed. `link` tracks a moving source; `copy` freezes one. */
export type InstallMode = "link" | "copy";

/** What the destination holds right now — the only filesystem fact the planner needs. */
export type DestState =
  | "missing"       // nothing there
  | "dir"           // a real directory (a copy, possibly hand-edited)
  | "link-ok"       // a symlink whose target exists
  | "link-dangling"; // a symlink whose target is gone — the skill vanishes with no error

export type InstallAction =
  /** Create the symlink. */
  | { kind: "link"; name: string; src: string; dest: string }
  /** Copy the tree, as an npm install always has. */
  | { kind: "copy"; name: string; src: string; dest: string }
  /** Move an existing real directory aside first — never delete it (see `backup`). */
  | { kind: "archive-then-link"; name: string; src: string; dest: string; backup: string }
  /** An existing link whose target is gone: remove and re-create, and say so. */
  | { kind: "replace-dangling"; name: string; src: string; dest: string }
  /** The source directory does not exist — do NOT leave a dangling link behind. */
  | { kind: "skip-missing"; name: string; src: string; dest: string };

export interface PlanInput {
  /** `<pkgRoot>/skills` */
  skillsSrc: string;
  /** `~/.claude/skills` or `<cwd>/.claude/skills` */
  skillsDest: string;
  /** The skill directory names to install. */
  names: string[];
  mode: InstallMode;
  /** What the destination holds. Injected so a test needs no real directory. */
  inspect: (destPath: string) => DestState;
  /**
   * Where an existing destination link points, resolved. Lets the planner tell "already
   * linked at this very source" (no archive needed — a link holds no content of its own)
   * from a link pointing somewhere else.
   */
  linkTarget?: (destPath: string) => string | null;
  /** Whether the SOURCE directory exists. Injected for the same reason as `inspect`. */
  srcExists?: (srcPath: string) => boolean;
  /** Injected for determinism in tests; defaults to now. */
  stamp?: string;
}

/**
 * The timestamp every archive in this project carries. Same format as
 * `handoverTranscriptOnce`'s, so a `.bak-` directory and an archived transcript read alike.
 */
export const archiveStamp = (d = new Date()): string => d.toISOString().replace(/[:.]/g, "-");

/**
 * Link when the package runs from a git checkout, copy otherwise.
 *
 * `.git` is direct evidence of a working copy that can move ahead of the install, and its
 * absence covers both remaining cases correctly: a `node_modules` install and an extracted
 * tarball each have no tracking source, so copying is the *right* answer, not a fallback.
 * (Sniffing for `node_modules` in the path was rejected: it answers a narrower question
 * than the one that matters, and misreads a checkout living under such an ancestor.)
 *
 * `.git` is a file, not a directory, inside a git worktree — `existsSync` covers both.
 */
export function resolveInstallMode(pkgRoot: string, opts: { forceCopy?: boolean } = {}): InstallMode {
  if (opts.forceCopy) return "copy";
  return existsSync(join(pkgRoot, ".git")) ? "link" : "copy";
}

/**
 * Decide, per skill, what installing it means here. Pure: every filesystem fact arrives
 * through `inspect`/`linkTarget`.
 */
export function planSkillInstall(input: PlanInput): InstallAction[] {
  const { skillsSrc, skillsDest, names, mode, inspect } = input;
  const stamp = input.stamp ?? archiveStamp();
  const linkTarget = input.linkTarget ?? (() => null);
  const srcExists = input.srcExists ?? existsSync;

  return names.map((name): InstallAction => {
    const src = join(skillsSrc, name);
    const dest = join(skillsDest, name);
    const state = inspect(dest);

    // A source that is not there must never become a link: a dangling symlink makes the
    // skill disappear from the session's list with no error at any layer — the one failure
    // indistinguishable from "this was never installed".
    if (!srcExists(src)) return { kind: "skip-missing", name, src, dest };

    if (mode === "copy") return { kind: "copy", name, src, dest };

    switch (state) {
      case "missing":
        return { kind: "link", name, src, dest };
      case "link-dangling":
        return { kind: "replace-dangling", name, src, dest };
      case "link-ok":
        // Already pointing at this source: nothing to archive, just re-assert it. Pointing
        // somewhere else is the same action — a link holds no content to preserve.
        return linkTarget(dest) === resolve(src)
          ? { kind: "link", name, src, dest }
          : { kind: "replace-dangling", name, src, dest };
      case "dir":
        return { kind: "archive-then-link", name, src, dest, backup: `${dest}.bak-${stamp}` };
    }
  });
}

/** Read the destination's state from the real filesystem. */
export function inspectDest(destPath: string): DestState {
  let st;
  try { st = lstatSync(destPath); } catch { return "missing"; }
  if (!st.isSymbolicLink()) return "dir";
  return existsSync(destPath) ? "link-ok" : "link-dangling";
}

/** Where a destination symlink actually points, resolved. `null` when it is not a link. */
export function destLinkTarget(destPath: string): string | null {
  try {
    if (!lstatSync(destPath).isSymbolicLink()) return null;
    return resolve(destPath, "..", readlinkSync(destPath));
  } catch {
    return null;
  }
}

/** The skill directories a package ships. */
export function skillNames(skillsSrc: string): string[] {
  if (!existsSync(skillsSrc)) return [];
  return readdirSync(skillsSrc).filter(n => {
    try { return statSync(join(skillsSrc, n)).isDirectory(); } catch { return false; }
  });
}

/**
 * Carry out the plan. The only place in this module that writes.
 *
 * Returns the actions that actually succeeded, because the report is rendered FROM this —
 * today's `console.log` named all six skills from a string literal while two of them were
 * absent from the destination, and a message that describes work rather than reporting it
 * is worse than no message: it is why the drift went unnoticed for weeks.
 */
export function applySkillInstall(actions: InstallAction[]): { done: InstallAction[]; failed: { action: InstallAction; error: string }[] } {
  const done: InstallAction[] = [];
  const failed: { action: InstallAction; error: string }[] = [];

  for (const action of actions) {
    if (action.kind === "skip-missing") { done.push(action); continue; }
    try {
      mkdirSync(dirname(action.dest), { recursive: true });
      switch (action.kind) {
        case "copy":
          rmSync(action.dest, { recursive: true, force: true });
          cpSync(action.src, action.dest, { recursive: true });
          break;
        case "link":
        case "replace-dangling":
          rmSync(action.dest, { recursive: true, force: true });
          symlinkSync(resolve(action.src), action.dest, "dir");
          break;
        case "archive-then-link":
          renameSync(action.dest, action.backup);
          // A backup left with its SKILL.md intact is still a skill directory under the
          // skills root, carrying the original `name:` — it would shadow the very install
          // that replaced it. Renaming the one file makes the archive inert without
          // touching what it preserves.
          neutralizeArchivedSkill(action.backup);
          symlinkSync(resolve(action.src), action.dest, "dir");
          break;
      }
      done.push(action);
    } catch (err) {
      failed.push({ action, error: (err as Error).message });
    }
  }
  return { done, failed };
}

/** Make an archived skill directory un-loadable without destroying anything in it. */
function neutralizeArchivedSkill(backupDir: string): void {
  const skillFile = join(backupDir, "SKILL.md");
  if (existsSync(skillFile)) renameSync(skillFile, `${skillFile}.bak`);
}
