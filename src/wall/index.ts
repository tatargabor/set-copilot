/**
 * `set-copilot wall` — start the local display server.
 *
 * Wires the pieces: resolve the category registry, build the server from the
 * config windows, and attach event sources. Two sources run concurrently to
 * prove the producer-agnostic seam: the scripted fake-feed (in-process) and a
 * JSONL tailer over the runtime-dir events file (the canonical log a real
 * out-of-process producer appends to). Prints each window's name + URL.
 *
 * The wall owns a small set of runtime-dir files, mirroring capture's PID
 * discipline: `wall.pid` (so `wall-stop` finds exactly this process) and
 * `wall.url` (so a launcher that passed `--port 0`-style fallback can read back
 * the port that was actually bound). A second wall in the same runtime dir is
 * refused while one is live, exactly as a second capture is — otherwise the PID
 * file is overwritten and the first server can never be stopped through it.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CopilotConfig } from "../config.js";
import { resolveCategories } from "./categories.js";
import { fakeFeedSource } from "./feed-script.js";
import { jsonlTailSource } from "./event-source.js";
import { resolveWindows } from "./layout.js";
import { WallServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The canonical events log a real producer appends to (design D7). */
export function wallEventsPath(cfg: CopilotConfig): string {
  return join(cfg.runtimeDir, "wall-events.jsonl");
}

/** PID of the wall serving this runtime dir — `wall-stop` reads it. */
export function wallPidPath(cfg: CopilotConfig): string {
  return join(cfg.runtimeDir, "wall.pid");
}

/** The base URL the wall actually bound (port may differ from the request on fallback). */
export function wallUrlPath(cfg: CopilotConfig): string {
  return join(cfg.runtimeDir, "wall.url");
}

/** How many consecutive ports to try before giving up when the first is taken. */
const PORT_FALLBACK_TRIES = 20;

export interface RunWallOptions {
  /** Override the config port. When taken, the next free port is used. */
  port?: number;
  /** Turn off the scripted demo feed (e.g. when real producers drive the wall). */
  fakeFeed?: boolean;
}

/** True when a wall is already live in this runtime dir (a stale PID file does not count). */
function liveWallPid(cfg: CopilotConfig): number | null {
  const pf = wallPidPath(cfg);
  if (!existsSync(pf)) return null;
  const pid = parseInt(readFileSync(pf, "utf-8").trim(), 10);
  if (!Number.isFinite(pid)) return null;
  try { process.kill(pid, 0); return pid; } catch { return null; } // ESRCH → stale
}

export async function runWall(cfg: CopilotConfig, opts: RunWallOptions = {}): Promise<WallServer> {
  const registry = await resolveCategories(cfg);
  const startPort = opts.port ?? cfg.wall.port;
  const publicDir = join(__dirname, "public");

  // Layouts resolve here, once: everything downstream sees only the resolved form,
  // so neither the server nor the client knows the legacy `slots` shape exists.
  const windows = resolveWindows(cfg.wall.windows, cfg.wall.layouts);
  if (!windows.length) {
    throw new Error("[set-copilot] wall: no window could be resolved — check wall.windows and wall.layouts");
  }

  // Refuse a second wall in the same runtime dir while one is live — overwriting
  // wall.pid would orphan the first server, still serving with nothing able to stop
  // it through the file. (Same invariant capture enforces for its own PID file.)
  const live = liveWallPid(cfg);
  if (live !== null) {
    throw new Error(`[set-copilot] wall: a wall is already running (pid ${live}) in ${cfg.runtimeDir} — stop it first (set-copilot wall-stop)`);
  }

  // Try the requested port, then walk forward until one binds. Concurrent sessions
  // each derive their own start port, but a collision (or a leftover socket) must
  // not be fatal: the wall is meant to "just come up".
  let server: WallServer | undefined;
  let port = startPort;
  for (let attempt = 0; attempt < PORT_FALLBACK_TRIES; attempt++) {
    port = startPort + attempt;
    const candidate = new WallServer({ port, windows, registry, publicDir, projectRoot: cfg.projectRoot, redaction: cfg.wall.redaction });
    candidate.addSource(jsonlTailSource(wallEventsPath(cfg)));
    if (opts.fakeFeed !== false) candidate.addSource(fakeFeedSource());
    try {
      await candidate.start();
      server = candidate;
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      // Port taken — try the next one. The failed server never wired its sources
      // (bind-first in WallServer.start), so there is nothing to tear down.
    }
  }
  if (!server) {
    throw new Error(`[set-copilot] wall: no free port in ${startPort}..${startPort + PORT_FALLBACK_TRIES - 1}`);
  }

  const base = `http://localhost:${port}`;

  // Claim the runtime dir: PID for `wall-stop`, URL for a launcher to read back the
  // bound port. Cleaned up on exit so a crashed wall does not leave a stale claim
  // that refuses the next start (liveWallPid also treats a dead PID as stale).
  writeFileSync(wallPidPath(cfg), String(process.pid));
  writeFileSync(wallUrlPath(cfg), base);
  const cleanup = () => {
    try { rmSync(wallPidPath(cfg), { force: true }); } catch { /* best effort */ }
    try { rmSync(wallUrlPath(cfg), { force: true }); } catch { /* best effort */ }
  };
  const shutdown = () => { cleanup(); server!.stop(); process.exit(0); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("exit", cleanup);

  console.log(`[set-copilot] wall serving on ${base}`);
  for (const w of windows) {
    console.log(`  ${w.name.padEnd(10)} ${base}${w.route}   (zones: ${w.zones.join("/")}, layout: ${w.layout.id})`);
  }
  console.log(`  events log: ${wallEventsPath(cfg)}`);
  if (opts.fakeFeed !== false) console.log(`  fake-feed:  on (pass --no-fake-feed for real producers only)`);
  return server;
}
