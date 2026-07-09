import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CopilotConfig } from "./config.js";

/** Is the capture process (from the PID file) still alive? */
function captureAlive(cfg: CopilotConfig): boolean {
  const pidFile = join(cfg.runtimeDir, "capture.pid");
  if (!existsSync(pidFile)) return false;
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  if (!Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9áéíóöőúüű]/g, "");
}

/**
 * Filter transcript lines: drop empty/"..." lines and mic/system echo duplicates
 * (containment check, two lines deep). Keeps silence events verbatim.
 */
function filterLines(lines: string[]): string[] {
  const out: string[] = [];
  let p1 = "";
  let p2 = "";
  for (const line of lines) {
    if (line.includes('"type":"silence"')) {
      out.push(line);
      continue;
    }
    const m = line.match(/"text":"((?:[^"\\]|\\.)*)"/);
    const s = normalize(m?.[1] ?? "");
    if (!s) continue;
    if ((p1 && (p1.includes(s) || s.includes(p1))) || (p2 && (p2.includes(s) || s.includes(p2)))) {
      p2 = p1;
      p1 = s;
      continue;
    }
    p2 = p1;
    p1 = s;
    out.push(line);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Long-poll the transcript. Blocks until a reaction-worthy event appears or
 * maxWaitSec elapses, then prints the accumulated (filtered) lines to stdout.
 *
 * Early return when the fresh batch contains an urgent line, a question, or a
 * silence event that closes a spoken thought unit. Emits {"type":"capture-dead"}
 * and exits when the capture process is gone.
 */
export async function runPoll(cfg: CopilotConfig, maxWaitSec = 60): Promise<void> {
  const file = cfg.transcriptOutput;
  const stateFile = join(cfg.runtimeDir, "poll-offset");
  const tick = 2000;

  let last = 0;
  if (existsSync(stateFile)) {
    const n = parseInt(readFileSync(stateFile, "utf-8").trim(), 10);
    if (Number.isFinite(n)) last = n;
  }

  const readAll = (): string[] =>
    existsSync(file) ? readFileSync(file, "utf-8").split("\n").filter(Boolean) : [];

  const start = Date.now();
  while (Date.now() - start < maxWaitSec * 1000) {
    if (!captureAlive(cfg)) {
      process.stdout.write('{"type":"capture-dead"}\n');
      return;
    }
    const all = readAll();
    if (all.length > last) {
      const pending = filterLines(all.slice(last));
      const early =
        pending.some((l) => l.includes('"urgency":"high"') || l.includes('"question":true')) ||
        (pending.some((l) => l.includes('"type":"silence"')) && pending.some((l) => l.includes('"speaker"')));
      if (early) break;
    }
    await sleep(tick);
  }

  const all = readAll();
  if (all.length > last) {
    const pending = filterLines(all.slice(last));
    if (pending.length) process.stdout.write(pending.join("\n") + "\n");
  }
  writeFileSync(stateFile, String(all.length));
}
