import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";
import { loadConfig } from "./config.js";
import { loadRegistry, lookupProjects, saveRegistry, touchProject, type ProjectRecord, type ProjectRegistry } from "./project-registry.js";

/**
 * `set-copilot meeting` — the front door to a meeting session.
 *
 * The launcher is deliberately NOT the lifecycle owner. It resolves the
 * project, verifies the chain is actually up (doctor, whose exit code is the
 * gate), and hands over to a Claude Code session that runs the meeting-copilot
 * skill — which scopes its own runtime dir, starts capture and wall, and stops
 * them. A launcher that minted the runtime dir would split ownership of the
 * lifecycle across two processes, the exact split that makes drawings and
 * transcript point at different places. Local flows keep working byte-identically
 * because nothing they use is touched; the packaged flow gets the same behavior
 * from a global install.
 */

/** Voice of the tool, not the meeting — matches the rest of the CLI. */
function fail(message: string): never {
  console.error(`[set-copilot] ${message}`);
  process.exit(1);
}

/** Audio capture is the one platform-bound piece; refuse before any probe or spawn. */
export function platformRefusal(p: NodeJS.Platform = platform()): string | null {
  if (p === "darwin" || p === "linux") return null;
  return `audio capture is unsupported on ${p} — set-copilot meeting runs on macOS and Linux (see docs/ROADMAP.md for the Windows capture plan)`;
}

/**
 * Resolve the `claude` binary the way `soxBin()` resolves sox: known install
 * locations first, then PATH. A GUI-launched terminal frequently lacks
 * ~/.local/bin on PATH, and that absence must read as "install it / fix PATH",
 * not as a mysterious ENOENT mid-launch.
 */
export function claudeBin(
  pathEnv: string = process.env.PATH ?? "",
  home: string = homedir(),
): string | undefined {
  const candidates = [
    join(home, ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const c of candidates) {
    if (isExecutableFile(c)) return c;
  }
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "claude");
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

function isExecutableFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export type ProjectResolution =
  | { ok: true; dir: string; record: ProjectRecord | null; source: string }
  | { ok: false; message: string };

/**
 * Resolution order per spec: explicit --project argument (a real directory, or
 * a registered name/path), then the most recently used registry entry, then
 * the current directory. Registration is never required — any existing
 * directory works, registered or not.
 */
export function resolveProject(opts: {
  projectArg?: string;
  registry: ProjectRegistry;
  cwd: string;
}): ProjectResolution {
  const { projectArg, registry, cwd } = opts;
  if (projectArg) {
    if (existsSync(projectArg)) {
      return { ok: true, dir: projectArg, record: lookupOne(registry, projectArg), source: "argument (directory)" };
    }
    const matches = lookupProjects(registry, projectArg);
    if (matches.length === 1) {
      return { ok: true, dir: matches[0].path, record: matches[0], source: "argument (registry)" };
    }
    if (matches.length > 1) {
      const list = matches.map((m) => `  ${m.name}  ${m.path}`).join("\n");
      return {
        ok: false,
        message: `"${projectArg}" matches several projects — pick one:\n${list}`,
      };
    }
    return {
      ok: false,
      message: `no project "${projectArg}" — not a directory, and no registry entry carries that name or path`,
    };
  }
  const used = registry.projects
    .filter((p): p is ProjectRecord & { lastUsedAt: string } => p.lastUsedAt !== null)
    .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
  if (used.length) {
    return { ok: true, dir: used[0].path, record: used[0], source: "most recently used" };
  }
  return { ok: true, dir: cwd, record: null, source: "current directory" };
}

function lookupOne(registry: ProjectRegistry, dir: string): ProjectRecord | null {
  return lookupProjects(registry, dir)[0] ?? null;
}

/**
 * The meeting-copilot skill must be discoverable before a session is spawned
 * on the strength of it — a session launched without the skill is a meeting
 * where `/meeting-copilot` is an unknown command. Both install modes count
 * equally: a checkout's symlink and a global install's copy are the same
 * answer. existsSync follows symlinks, so a dangling link reads as absent —
 * which is the skill-install rule that a dangling link makes a skill vanish
 * silently from the list.
 */
export function findMeetingSkill(projectDir: string, home: string = homedir()): string | undefined {
  for (const p of [
    join(projectDir, ".claude", "skills", "meeting-copilot", "SKILL.md"),
    join(home, ".claude", "skills", "meeting-copilot", "SKILL.md"),
  ]) {
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      // absent or dangling — try the next location
    }
  }
  return undefined;
}

/** `/meeting-copilot start wall`, with the skill's own mode words composed in its grammar (`start --lite wall`). */
export function openingPrompt(opts: { micOnly?: boolean; extra?: string[] } = {}): string {
  const parts = ["/meeting-copilot", "start"];
  if (opts.micOnly) parts.push("--lite");
  parts.push("wall");
  if (opts.extra?.length) parts.push(...opts.extra);
  return parts.join(" ");
}

/**
 * The CLI body. Gate order is the spec's: platform → project → claude binary →
 * skill → doctor (whose exit code ends this process on failure) → spawn.
 * `--dry-run` prints every decision and stops before doctor.
 */
export async function runMeeting(args: string[]): Promise<void> {
  const sep = args.indexOf("--");
  const flagged = sep >= 0 ? args.slice(0, sep) : args;
  const extra = sep >= 0 ? args.slice(sep + 1) : [];
  const projectArg = flagged.includes("--project") ? flagged[flagged.indexOf("--project") + 1] : undefined;
  const micOnly = flagged.includes("--mic-only");
  const dryRun = flagged.includes("--dry-run");

  const refusal = platformRefusal();
  if (refusal) fail(refusal);

  const registry = loadRegistry();
  const resolution = resolveProject({ projectArg, registry, cwd: process.cwd() });
  if (!resolution.ok) fail(resolution.message);
  const { dir, record, source } = resolution;

  const claude = claudeBin();
  if (!claude) {
    fail(
      "Claude Code was not found — install it with:  curl -fsSL https://claude.ai/install.sh | bash   (macOS/Linux), then reopen your shell",
    );
  }

  const skill = findMeetingSkill(dir);
  if (!skill) {
    fail(
      `the meeting-copilot skill is not installed for ${dir} — run:  set-copilot init   (in the project) or  set-copilot init --global   (user-wide)`,
    );
  }

  const prompt = openingPrompt({ micOnly, extra });
  // Tooling voice on stderr (the [set-copilot] convention) — stdout stays clean
  // for anyone wrapping this command the way the skills do.
  console.error(`[set-copilot] project:  ${dir}  (${source})`);
  console.error(`[set-copilot] claude:    ${claude}`);
  console.error(`[set-copilot] skill:     ${skill}`);
  console.error(`[set-copilot] preflight: set-copilot doctor (in ${dir})`);
  console.error(`[set-copilot] opening:   claude "${prompt}"`);

  if (dryRun) {
    console.log("[set-copilot] dry run — nothing probed, nothing spawned");
    return;
  }

  // Doctor probes the real audio chain + STT credentials and exits non-zero on
  // failure — its exit IS the gate, so the launcher adds no judgement of its
  // own. From here the project is the cwd, so the probe (and everything after)
  // reads the project's config and .env.
  process.chdir(dir);
  const { runDoctor } = await import("./doctor.js");
  await runDoctor(loadConfig(), {});

  const child = spawn(claude, [prompt], { cwd: dir, stdio: "inherit" });
  child.on("error", (err) => {
    fail(`could not start Claude Code (${err.message})`);
  });
  // Usage is recorded only on a successful spawn — a meeting that never
  // happened must not become the resolution target of the next bare `meeting`.
  child.on("spawn", () => {
    console.error("[set-copilot] session started — capture, wall and stop belong to it now");
    const fresh = loadRegistry();
    if (touchProject(fresh, dir)) saveRegistry(fresh);
  });
  child.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
}
