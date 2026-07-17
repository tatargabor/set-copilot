/**
 * `set-copilot wall` — start the local display server.
 *
 * Wires the pieces: resolve the category registry, build the server from the
 * config windows, and attach event sources. Two sources run concurrently to
 * prove the producer-agnostic seam: the scripted fake-feed (in-process) and a
 * JSONL tailer over the runtime-dir events file (the canonical log a real
 * out-of-process producer appends to). Prints each window's name + URL.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CopilotConfig } from "../config.js";
import { resolveCategories } from "./categories.js";
import { fakeFeedSource } from "./feed-script.js";
import { jsonlTailSource } from "./event-source.js";
import { WallServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The canonical events log a real producer appends to (design D7). */
export function wallEventsPath(cfg: CopilotConfig): string {
  return join(cfg.runtimeDir, "wall-events.jsonl");
}

export interface RunWallOptions {
  /** Override the config port. */
  port?: number;
  /** Turn off the scripted demo feed (e.g. when real producers drive the wall). */
  fakeFeed?: boolean;
}

export async function runWall(cfg: CopilotConfig, opts: RunWallOptions = {}): Promise<WallServer> {
  const registry = await resolveCategories(cfg);
  const port = opts.port ?? cfg.wall.port;
  const publicDir = join(__dirname, "public");

  const server = new WallServer({ port, windows: cfg.wall.windows, registry, publicDir });

  // The JSONL tailer is always attached — it is the seam real producers use, and
  // it replays the canonical log on restart. The fake-feed is the dev harness.
  server.addSource(jsonlTailSource(wallEventsPath(cfg)));
  if (opts.fakeFeed !== false) server.addSource(fakeFeedSource());

  await server.start();

  const base = `http://localhost:${port}`;
  console.log(`[set-copilot] wall serving on ${base}`);
  for (const w of cfg.wall.windows) {
    console.log(`  ${w.name.padEnd(10)} ${base}${w.route}   (zones: ${w.zones.join("/")})`);
  }
  console.log(`  events log: ${wallEventsPath(cfg)}`);
  if (opts.fakeFeed !== false) console.log(`  fake-feed:  on (pass --no-fake-feed for real producers only)`);
  return server;
}
