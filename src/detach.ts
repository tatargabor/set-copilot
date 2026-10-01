/**
 * `--detach` for the long-running commands (`capture`, `wall`).
 *
 * A meeting outlives the tool call that started it. Run from Claude Code as a background
 * command, a capture is killed at the harness's background time limit — measured on a
 * real call: the first capture died after 30 minutes, the restarted one at exactly two
 * hours, mid-sentence, and the wall with it. Nothing in set-copilot stopped them, and
 * nothing said so until the transcript ran out.
 *
 * So the command re-launches itself in its own session (`detached`), writes its output to
 * `<runtimeDir>/<command>.log`, and returns. The process then lives until `stop` /
 * `wall-stop` (they find it by its PID file, exactly as before) or its own `--max-minutes`.
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DETACHABLE = new Set(["capture", "wall"]);
/** How long to watch the child before calling the start a success. */
const STARTUP_GRACE_MS = 1500;

export function detachLogPath(runtimeDir: string, cmd: string): string {
  return join(runtimeDir, `${cmd}.log`);
}

/** The argv for the detached child: the same command, minus `--detach`. */
export function childArgs(cmd: string, args: string[]): string[] {
  return [cmd, ...args.filter((a) => a !== "--detach")];
}

/**
 * Re-launch `cmd` detached when `--detach` was given. Returns true when it did (the caller
 * must then return without running the command itself).
 */
export async function maybeDetach(cmd: string | undefined, args: string[], runtimeDir: string): Promise<boolean> {
  if (!cmd || !DETACHABLE.has(cmd) || !args.includes("--detach")) return false;

  mkdirSync(runtimeDir, { recursive: true });
  const log = detachLogPath(runtimeDir, cmd);
  const fd = openSync(log, "a");
  const child = spawn(process.execPath, [process.argv[1]!, ...childArgs(cmd, args)], {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, SET_COPILOT_DIR: runtimeDir },
  });
  closeSync(fd);

  let exitCode: number | null = null;
  child.on("exit", (code) => { exitCode = code ?? 1; });
  await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS));

  if (exitCode !== null) {
    const tail = existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n").slice(-15).join("\n") : "";
    console.error(`[set-copilot] ${cmd} exited during start-up (code ${exitCode}) — log: ${log}`);
    if (tail) console.error(tail);
    process.exitCode = 1;
    return true;
  }
  child.unref();
  console.log(`[set-copilot] ${cmd} running detached (pid ${child.pid}) — log: ${log}`);
  return true;
}
