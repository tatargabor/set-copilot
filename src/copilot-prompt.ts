/**
 * Renders the copilot's *policy* — what it may speak up about, and the project's
 * own reading instructions — as markdown the skill loads at session start.
 *
 * The skill file owns the mechanics (capture, poll loop, output shape); this owns
 * the judgement. That split is why a project can add a category or rewrite the
 * domain rules without forking skills/meeting-copilot/SKILL.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CopilotConfig } from "./config.js";
import type { AlertCategory } from "./knowledge/types.js";

const RANK: Record<AlertCategory["priority"], number> = { high: 0, medium: 1, low: 2 };

function label(a: AlertCategory): string {
  return (a.label ?? a.key).toUpperCase();
}

export function renderAlerts(alerts: AlertCategory[]): string {
  const sorted = [...alerts].sort((a, b) => RANK[a.priority] - RANK[b.priority]);
  const lines: string[] = ["## Alert categories", ""];
  for (const a of sorted) {
    const notify = a.notify ? ", desktop notification" : "";
    lines.push(`${a.emoji} **${label(a)}** (${a.priority} priority${notify})`);
    lines.push(`  Speak up when: ${a.when}`);
    lines.push("");
  }

  const notifiable = sorted.filter((a) => a.notify);
  if (notifiable.length) {
    lines.push(
      `For ${notifiable.map((a) => `${a.emoji} ${label(a)}`).join(" / ")} also fire a desktop notification, so it cuts through when the terminal is not visible:`,
      "",
      "```bash",
      'npx set-copilot notify "<emoji> <LABEL>: <one-line claim>" "<max 2 sentences + source>" --critical',
      "```",
      "",
    );
  }

  lines.push(
    "Anything that does not fit a category above: **say nothing.** Not a filler line, not an acknowledgement — end the turn with no visible text. Mundane conversation, greetings, scheduling, repetition of known facts, and uncertainty all mean silence.",
    "",
    "Output goes into the chat as normal text, at most 3 lines per alert:",
    "",
    "```",
    `${sorted[0]?.emoji ?? "⚠"} ${label(sorted[0] ?? { key: "alert", priority: "high", emoji: "⚠", when: "" })}: <the claim in one line> (<source>)`,
    "  <why it matters, max 2 sentences>",
    "```",
    "",
  );
  return lines.join("\n");
}

/**
 * The project's own instructions file, loaded verbatim. Missing file is not an
 * error: most projects never write one, and the alert categories alone are a
 * working policy.
 */
export function readInstructions(cfg: CopilotConfig): string {
  if (!cfg.copilot.instructions) return "";
  const path = resolve(cfg.projectRoot, cfg.copilot.instructions);
  if (!existsSync(path)) {
    return `> [set-copilot] copilot.instructions points at ${cfg.copilot.instructions}, which does not exist.\n`;
  }
  return readFileSync(path, "utf-8").trim() + "\n";
}

/** The full policy block: categories first, then the project's own instructions. */
export function renderCopilotPrompt(cfg: CopilotConfig): string {
  const parts = [renderAlerts(cfg.copilot.alerts)];
  const instructions = readInstructions(cfg);
  if (instructions) parts.push("## Project instructions", "", instructions);
  return parts.join("\n");
}
