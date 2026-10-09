/**
 * Replay a recorded transcript through the spoken-command lane and count what it emits.
 *
 *   npx tsx scripts/fast-lane-replay.ts <transcript.jsonl> [--project <dir>] [--legacy]
 *
 * The measuring stick for command-trigger-precision: how many commands (and false `command-abandoned`
 * events) the lane would produce on a real meeting, under the project's resolved
 * `copilot.fastLane`. `--legacy` replays the earlier rule (every channel, any
 * position, `start` as an opener) for comparison.
 *
 * It is a LINE-level replay: each speech line is fed as one piece, per speaker, in file
 * order, with `startTs ?? ts` as the speech time. The live engine saw Soniox tokens, so
 * this is a consistent ruler for comparing rules, not a recreation of the meeting — the
 * meeting this was built against logged 16 abandons live and replays to 11 under the old rule.
 *
 * Read-only: the transcript is real speech and lives in a gitignored runtime dir; nothing
 * is written anywhere.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../src/config.js";
import { FastLane, type FastLaneConfig, type FastLaneEvent } from "../src/fast-lane.js";

function usage(): never {
  console.error("usage: npx tsx scripts/fast-lane-replay.ts <transcript.jsonl> [--project <dir>] [--legacy]");
  process.exit(2);
}

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--project");
if (!file) usage();
const projectIdx = args.indexOf("--project");
const projectDir = projectIdx >= 0 ? args[projectIdx + 1] ?? usage() : process.cwd();

const resolved = loadConfig(resolve(projectDir)).copilot.fastLane;
const cfg: FastLaneConfig = args.includes("--legacy")
  ? { ...resolved, start: [...new Set([...resolved.start, "start"])], channels: ["mic", "system"], utteranceStart: false }
  : resolved;

interface Line { type?: string; speaker?: string; text?: string; ts?: number; startTs?: number }

const lines: Line[] = [];
for (const raw of readFileSync(resolve(file), "utf8").split("\n")) {
  if (!raw.trim()) continue;
  try {
    lines.push(JSON.parse(raw) as Line);
  } catch {
    // A torn last line (capture killed mid-write) is not speech; skip it.
  }
}

// Every channel is fed: the lane itself decides which ones may open a command.
const lane = new FastLane({ ...cfg });
const events: FastLaneEvent[] = [];
let last = 0;
for (const l of lines) {
  if (l.type !== undefined || !l.text || !l.speaker) continue;
  const ts = l.ts ?? last;
  last = ts;
  events.push(...lane.feed(l.speaker, " " + l.text.trim(), l.startTs ?? ts, ts));
}
events.push(...lane.close(last));

const counts: Record<string, { command: number; abandoned: number }> = {};
for (const ev of events) {
  const c = (counts[ev.speaker] ??= { command: 0, abandoned: 0 });
  if (ev.kind === "command") c.command++;
  else c.abandoned++;
}

console.log(`rule: ${args.includes("--legacy") ? "legacy (any channel, any position)" : "resolved config"} · openers ${cfg.start.join(",")} · channels ${cfg.channels.join(",")} · utteranceStart ${cfg.utteranceStart}`);
const total = { command: 0, abandoned: 0 };
for (const [speaker, c] of Object.entries(counts)) {
  console.log(`${speaker}\tcommand ${c.command}\tcommand-abandoned ${c.abandoned}`);
  total.command += c.command;
  total.abandoned += c.abandoned;
}
console.log(`total\tcommand ${total.command}\tcommand-abandoned ${total.abandoned}`);
