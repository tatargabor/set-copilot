/**
 * The producer-agnostic event source (design D7). The server ingests from these
 * rather than from one hard-wired producer, so any number of producers — the
 * scripted fake-feed here, a real graph worker later — merge into one broadcast.
 *
 * The cross-process seam is JSONL append-and-tail, mirroring the existing
 * `capture` → `transcript.jsonl` → `poll` pattern: out-of-process producers
 * append category-tagged JSON lines to a runtime-dir events file, and the server
 * tails it. That file is the *canonical* log — the server rebuilds display state
 * from it, so no producer's in-memory state has to be reconciled on a late
 * connect or a restart.
 */

import { existsSync, readFileSync } from "node:fs";

import type { WireMessage } from "./types.js";

/** Anything that feeds the server. `start` wires the callback; `stop` tears down. */
export interface EventSource {
  readonly name: string;
  start(onMessage: (m: WireMessage) => void): void;
  stop(): void;
}

/** Parse one JSONL line into a WireMessage, or null (with a warning) if malformed. */
export function parseWireLine(line: string, warn: (msg: string) => void = console.warn): WireMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object") return obj as WireMessage;
    warn(`[set-copilot] wall: dropping non-object events line`);
    return null;
  } catch {
    warn(`[set-copilot] wall: dropping unparseable events line: ${trimmed.slice(0, 80)}`);
    return null;
  }
}

/** Read all currently-present lines of a JSONL file (for the initial rebuild). */
export function readAllLines(file: string): string[] {
  return existsSync(file) ? readFileSync(file, "utf-8").split("\n").filter(Boolean) : [];
}

/**
 * A JSONL append-and-tail source over a runtime-dir events file. On start it
 * replays every line already in the file (canonical rebuild), then polls for
 * appended lines — the same line-offset approach `poll` uses, which needs no
 * fs.watch and behaves the same across platforms.
 */
export function jsonlTailSource(file: string, tickMs = 200): EventSource {
  let timer: NodeJS.Timeout | undefined;
  let seen = 0;

  return {
    name: `jsonl:${file}`,
    start(onMessage) {
      const drain = (): void => {
        const lines = readAllLines(file);
        if (lines.length <= seen) return;
        for (const line of lines.slice(seen)) {
          const msg = parseWireLine(line);
          if (msg) onMessage(msg);
        }
        seen = lines.length;
      };
      drain(); // initial rebuild from the canonical log
      timer = setInterval(drain, tickMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
