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

import type { CopilotConfig, CopilotPromptConfig, Engagement } from "./config.js";
import type { AlertCategory } from "./knowledge/types.js";
import type { Category } from "./wall/types.js";

const RANK: Record<AlertCategory["priority"], number> = { high: 0, medium: 1, low: 2 };

function label(a: AlertCategory): string {
  return (a.label ?? a.key).toUpperCase();
}

/**
 * The engagement rule. This used to be one hardcoded paragraph ("anything else: say
 * nothing"), which made "how talkative is it" a property of the package rather than
 * of the project. It is now config: a bug triage wants a watcher, a design call wants
 * a third participant, and the same binary must do both.
 */
function renderEngagement(engagement: Engagement, maxLines: number, allowWeb: boolean): string[] {
  const lines: string[] = ["## Engagement — how much of a voice you have", ""];

  if (engagement === "silent") {
    lines.push(
      "**silent.** Only the `high` priority categories above. Everything else — medium, low, anything uncategorised — is silence. Do not volunteer, do not elaborate, do not acknowledge.",
    );
  } else if (engagement === "reactive") {
    lines.push(
      "**reactive.** You are a watcher, not a participant. Speak when a category above fires; otherwise **say nothing** — not a filler line, not an acknowledgement, end the turn with no visible text. Mundane conversation, greetings, scheduling, repetition of known facts, and your own uncertainty all mean silence.",
    );
  } else {
    lines.push(
      "**participant.** You are a third voice in this conversation, not a monitor. The speakers WANT you to talk. Beyond the categories above, you may volunteer whenever you can genuinely move the conversation:",
      "",
      "- **Confirm** a claim that the knowledge base supports — say so, with the source. A confirmed claim lets them move on faster.",
      "- **Refute** a claim that the knowledge base contradicts — say so plainly, with the source. This is the single most valuable thing you do; do not soften it.",
      "- **Add** the fact they are circling but have not said — the number, the file, the prior outcome, the constraint they are about to violate.",
      "- **Answer** an open question they raise, even rhetorically, if you actually know.",
      "",
      "Talk like a colleague who knows the material: assert, cite, and be brief. React in the same round — a fast half-answer beats a perfect late one.",
      "",
      "**Still no filler.** \"Interesting point\", \"I'm listening\", restating what they just said, hedging when you don't know — all of these are worse than silence. Speaking without adding is the failure mode of this mode. When you have nothing, end the turn with no visible text.",
    );
  }

  lines.push("");
  if (allowWeb) {
    lines.push(
      "**Background research is allowed** (WebSearch / WebFetch) when an outside fact would settle something — a spec, an API's real behaviour, a claim about a tool. Prefer a pause (`{\"type\":\"silence\"}`) for it; it costs seconds, and a late answer to a moved-on topic is noise. Say where the answer came from.",
      "",
    );
  }
  lines.push(`Keep each contribution to **at most ${maxLines} lines**.`, "");
  return lines;
}

/**
 * The narrow feedback opening (design D1 of wall-feedback-and-replay). The engagement
 * rule above governs how eagerly the copilot speaks about *content*; this bounds its
 * silence in two orthogonal cases, because a copilot whose only channel is a wall that
 * may not visibly update looks broken when it stays mute. It never widens the
 * multi-party content policy — only direct address and echoing its own wall emissions.
 */
function renderFeedback(): string[] {
  return [
    "## Feedback — liveness & wall echo",
    "",
    "The engagement rule governs what you say about the *conversation*. It does NOT make you silent in these two cases:",
    "",
    "- **Direct address.** When the mic speaker speaks to you (asks if you heard them, asks you to draw/show something, asks a question of you), answer briefly in chat — even if no category fires. Silence to a direct question reads as broken, not disciplined.",
    "- **Wall echo.** Whenever you emit a wall visual (graph, chart, or a wall-only note), also write ONE short chat line saying what you understood — the interpretation, not the raw transcript. The wall is a secondary artifact; chat is your primary voice, and it must never be the case that the wall is the only sign you acted.",
    "",
    "**Ambiguity is a chat question, not a wall fact.** If an extraction is ambiguous (numbers given only relatively, an unclear reference), state your assumption in chat or ask — do not render a guessed value on the wall as established fact. A wall carries authority; never lend it to a guess.",
    "",
    "This is still not filler: no \"I'm listening\", no restating. A brief, substantive acknowledgement of a direct address or your own emission — then stop.",
    "",
  ];
}

/**
 * The wall drawing contract (fork-wall-producer D2).
 *
 * This block exists to be *inherited*, not re-supplied. A producer is a fork of the
 * session that loaded this policy, so everything every drawing needs — the category
 * registry, the payload shapes, the emit command, the project's conventions — is
 * paid for once here and reaches every fork as a cache read. A fork's own prompt
 * therefore carries only its mandate ("draw the metrika slot for what we just said").
 *
 * The categories come from `wall.categories`, which is already config; they are not
 * restated here. The conventions come from `copilot.drawing.conventions`. Only the
 * payload shapes are hardcoded, because those are engine mechanics — the same split
 * as SKILL.md (mechanics) vs. config (judgement).
 */
export function renderDrawingContract(categories: Category[], conventions: string[]): string[] {
  if (!categories.length) return [];

  const lines: string[] = [
    "## Drawing the wall",
    "",
    "You can put things on the monitor wall. Do it by spawning a **fork** of yourself (`subagent_type: \"fork\"`) with a mandate naming ONE slot; the fork inherits this whole context — which is exactly why it knows what matters — draws, emits, and exits. You keep talking in chat while it works.",
    "",
    "Do not pass a model override to a producer fork: a fork always runs on your model, and the override is ignored. Do not spawn a fork to wait for work, and never spawn one just to keep a cache warm.",
    "",
    "**Categories** (id → what it renders):",
    "",
  ];
  for (const c of categories) {
    lines.push(`- \`${c.id}\` ${c.icon ? `${c.icon} ` : ""}— renders as **${c.render}**`);
  }
  lines.push(
    "",
    "**Emit** one event or an array of them:",
    "",
    "```bash",
    "npx set-copilot wall-emit '<json>'",
    "```",
    "",
    "Payload shapes — `category` is required, plus exactly one payload. `zone` is `private` | `public` | `both` (default `both`); `priority: \"immediate\"` skips the pacing; `visual` groups graph deltas, and `op: \"reset\"` with a new `visual` id starts a new picture:",
    "",
    "```json",
    '{"category":"<text-cat>","zone":"private","text":"…"}',
    '{"category":"<graph-cat>","visual":"<id>","graph":{"op":"reset","nodes":[{"id":"a","label":"A"}],"edges":[{"source":"a","target":"b","label":"…"}]}}',
    '{"category":"<chart-cat>","chart":{"type":"bar","title":"…","unit":"%","data":[{"label":"…","value":1}]}}',
    "```",
    "",
  );

  if (conventions.length) {
    lines.push("**When to draw:**", "");
    for (const c of conventions) lines.push(`- ${c}`);
    lines.push("");
  }
  return lines;
}

export function renderAlerts(alerts: AlertCategory[], opts?: Partial<CopilotPromptConfig>): string {
  const engagement = opts?.engagement ?? "reactive";
  const maxLines = opts?.maxLines ?? 3;
  const allowWeb = opts?.allowWebResearch ?? false;
  const acknowledge = opts?.acknowledge ?? true;

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

  lines.push(...renderEngagement(engagement, maxLines, allowWeb));
  if (acknowledge) lines.push(...renderFeedback());

  lines.push(
    "Output goes into the chat as normal text:",
    "",
    "```",
    `${sorted[0]?.emoji ?? "⚠"} ${label(sorted[0] ?? { key: "alert", priority: "high", emoji: "⚠", when: "" })}: <the claim in one line> (<source>)`,
    "  <why it matters>",
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

/**
 * The full policy block: alert categories, then the wall drawing contract, then the
 * project's own instructions. The drawing contract sits here rather than in the skill
 * so it is loaded once and inherited by every producer fork (fork-wall-producer D2).
 */
export function renderCopilotPrompt(cfg: CopilotConfig): string {
  const parts = [renderAlerts(cfg.copilot.alerts, cfg.copilot)];
  // Tolerate a hand-built config: CopilotConfig is exported, so consumers construct
  // one, and a missing wall/drawing section means "no wall", not a crash.
  if (cfg.copilot.drawing?.enabled) {
    const drawing = renderDrawingContract(
      cfg.wall?.categories ?? [],
      cfg.copilot.drawing.conventions ?? [],
    );
    if (drawing.length) parts.push(drawing.join("\n"));
  }
  const instructions = readInstructions(cfg);
  if (instructions) parts.push("## Project instructions", "", instructions);
  return parts.join("\n");
}
