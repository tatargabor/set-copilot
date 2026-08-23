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
import { resolveWindows } from "./wall/layout.js";
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
/**
 * Turn order — engine mechanics, not judgement, and the only latency lever the policy has.
 *
 * Measured on the 2026-08-23 real-time replay: a reaction reached the wall 39.4 s after
 * the line that warranted it. The split was 14.5 s waiting for the next poll and 24.9 s
 * of model turn — and the poll itself returned in 2.5 s every single time, i.e. the gate
 * was never the thing waiting. Each cycle held exactly ONE `wall-emit`, issued after the
 * whole turn had been composed: alert, narration, pinned summary, staging and promotion
 * decided together, then published together. So the alert paid for the narration's
 * deliberation, and the next line paid for all of it.
 *
 * This block says: get the reaction out first, then compose the rest. It changes no
 * content and drops nothing — only the order, which is what latency is made of. It is
 * engine text rather than config because it is about how a turn is executed, not about
 * what this project considers worth saying.
 */
function renderTurnOrder(): string[] {
  return [
    "## Turn order — the reaction goes out first",
    "",
    "A meeting does not wait for you to finish thinking. When a poll returns lines that fire a category above:",
    "",
    "1. **First tool call: `wall-emit` with the reaction alone.** Do not compose the narration line, the pinned summary, the staging or a promotion before it goes out. One alert, out, now.",
    "2. **Then everything else, batched.** Narration, pinned updates, drawings, staging and promotions go in ONE further `wall-emit` (it accepts a JSON array), not one call each.",
    "3. **Then get back to listening immediately.** If you drive the poll yourself (a Bash loop, no Monitor), chain it onto the same command (`… wall-emit '…' ; … poll 30`) — a separate round trip is dead time in which the room keeps talking. With a Monitor the next batch is already on its way; just end the turn.",
    "",
    "If nothing fires a category, there is no step 1 — go straight to the batch. This is an ordering rule, never a licence to drop content: everything you would have said still gets said, just not ahead of the alert.",
    "",
  ];
}

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
 * The continuous-narration mandate (live-narration D2/D4).
 *
 * A channel of its own — separate from the event-triggered alert taxonomy and from
 * `engagement`, which governs chat about content. Rendered ONLY when narration is
 * enabled, and as its own top-level section appended by `renderCopilotPrompt`, so the
 * alert/engagement/feedback policy text is byte-for-byte identical whether narration is
 * on or off. Disabling narration removes this section and emits nothing — the pre-change
 * reactive behavior.
 *
 * Verbosity is a config lever surfaced here as words, never a regex in `src/`. The
 * hardest line to hold is NO-FILLER: "be more talkative" degrades into "I'm listening"
 * unless the mandate forbids it explicitly, so it does.
 */
function renderNarration(narration: CopilotConfig["copilot"]["narration"]): string[] {
  const detail: Record<typeof narration.verbosity, string> = {
    terse: "Only when the substance is unmistakable, and in as few words as carry it — err toward fewer lines.",
    normal: "One substantive line per batch: the topic under discussion or the decision taking shape, briefly.",
    rich: "Track the thread closely — name the topic, the decision forming, and the knowledge-base tie when there is one.",
  };
  return [
    "## Narration — the live commentary lane (private)",
    "",
    "A channel of its own, separate from the alert categories above and from the engagement rule: a running, **substantive** commentary of what is being discussed, written into the private `narráció` box. Emit it **directly** with `wall-emit` (`zone:\"private\"`) — no fork; one line has nothing to compose.",
    "",
    "- **Cadence — regular, not per-token, not per-alert.** At most ONE line per reaction batch, plus one on each `silence` window. Never a line per transcript token, and never wait for an alert to fire. The box is `scroll`, so lines accumulate — you are keeping a live log, not replacing a headline.",
    "- **Substance only — NO FILLER, EVER.** Every line says something: the topic under discussion, a decision being formed, or how it ties to the knowledge base (name the source when you can). NEVER \"I'm listening\" / \"waiting\" / \"still here\", and never a bare restatement of the raw transcript. If the latest batch holds nothing you can substantively summarize or relate, emit NOTHING — the box keeps its previous line. Silence is correct; filler is not.",
    `- **Verbosity — ${narration.verbosity}.** ${detail[narration.verbosity]} At most **${narration.maxLines}** line(s) per emission.`,
    "- **Private by default.** Narration is `zone:\"private\"`; it never reaches a public wall on its own. Promoting it to a public audience is a separate, redaction-gated decision, not something this channel does autonomously.",
    "",
  ];
}

/**
 * The chat→wall mirroring mandate (wall-chat-mirror). Rendered ONLY when mirroring is
 * enabled, exactly like narration — so with mirroring off the policy text above is
 * byte-for-byte the pre-change output. It is an opt-in overlay on the primary voice: the
 * copilot keeps talking in chat and *additionally* echoes each substantive line to the
 * wall, through the same redaction funnel as any event.
 */
function renderMirror(mirror: CopilotConfig["copilot"]["mirror"]): string[] {
  // Everything factual here is derived from the RESOLVED policy, never restated. A restated
  // policy rots: on 2026-07-29 the skill still taught that the mirror strips code blocks,
  // long after the default became `keep`, so the copilot sent an ASCII table UNFENCED to
  // survive a stripping that no longer happened — and lost monospace rendering, unreadable on
  // the wall. Same seam and same reason as `copilot.alerts` and `copilot.drawing`.
  const codeBlocks: Record<typeof mirror.codeBlocks, string> = {
    keep: "**Fenced code blocks are kept** and render as monospace blocks on the wall — so fence anything whose readability depends on alignment (an ASCII/box-drawing table, aligned columns). If you forget, the delivery path fences it for you; fencing it yourself is just more predictable.",
    strip: "**Fenced code blocks are removed** before the line reaches the wall — this project asked for a code-free wall, so do not put meaning only inside a fence.",
    collapse: "**Fenced code blocks are collapsed** to a one-line marker (language + line count), so do not put meaning only inside a fence.",
  };
  return [
    "## Mirroring — chat onto the wall (opt-in)",
    "",
    `Mirroring is **on** this session. Chat is still your primary voice; each substantive chat line is *additionally* shown on the wall as a \`${mirror.category}\` event, so a wall audience can also read it.`,
    "",
    "- **A transcript follower does the mirroring — not you.** `set-copilot mirror-follow` watches this session's transcript and emits **every** text block you write, as you write it — mid-turn included, not just the turn's last message. **Do NOT `wall-emit` the mirror yourself** — that would double it.",
    `- **Length is a chunk size, not a ceiling.** A message longer than ${mirror.maxLength} characters is delivered as several consecutive wall events, split on block boundaries — nothing is truncated away, so write the whole thing.`,
    `- **Below ${mirror.minLength} characters is treated as filler** and never reaches the wall, as are the project's configured progress phrases. Say something worth showing, or end the turn silently.`,
    `- ${codeBlocks[mirror.codeBlocks]}`,
    "- **Headings render as headings**, and a markdown table renders as a table. Structure your wall-bound messages with them — the wall is read from across a room.",
    "- **Delivery is per completed message, not per token.** The wall gets a block when you finish writing it, while the chat has been rendering it progressively. That difference is expected, not a fault.",
    "- **Redaction still applies.** The mirrored line goes through the SAME public-zone redaction as any event. Keep an internal detail off the public wall by marking the span `[belső]`; the server scrubs it before any public client sees it.",
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
    // Taught here, not left implied. The contract described staging and said only a
    // promotion lifts a visual public, then documented every payload shape EXCEPT that
    // one — and across four measured runs every prediction expired unpromoted.
    "**Promoting a prediction.** A visual you drew ahead into staging reaches the public wall only by this command — and it names the visual, so a staged prediction MUST carry a `visual` id:",
    "",
    "```json",
    '{"kind":"promote","category":"<staged-cat>","visual":"<id>","zone":"public"}',
    "```",
    "",
    "Promote when the conversation **actually arrives** at what the prediction anticipated — not on a timer, and not because it has been sitting there. A guess that expires unused is a *correct* outcome for a guess that turned out wrong, not a miss; what would be wrong is putting an unspoken guess in front of an audience.",
    "",
    "You do not have to remember what you staged — ask:",
    "",
    "```bash",
    "npx set-copilot wall-staged",
    "```",
    "",
    "**Public zone & internal content.** Anything `public` or `both` can reach a wall a live audience sees. Before it does, the server runs public-zone redaction over the whole payload. To keep an internal detail off the public wall, either use `zone:\"private\"` (the only reliable guarantee), or mark the sensitive span **`[belső]`** — the server scrubs from the marker to the end of that string, or withholds the event if the marker lands in an `image.src`/`webpage.url`. Redaction is a backstop, not a license: when in doubt, mark it `[belső]` or leave it out. A redaction failure withholds the event from the public zone, never leaks it.",
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

  lines.push(...renderTurnOrder());
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
 * A box policy's instructions: a path to a markdown file if one exists there,
 * otherwise the string verbatim. Both forms are useful — a project with real
 * domain rules wants a file, and a one-sentence mandate ("narrate, don't
 * transcribe") is not worth one.
 */
function boxInstructions(cfg: CopilotConfig, instructions: string): string {
  const path = resolve(cfg.projectRoot, instructions);
  if (existsSync(path)) return readFileSync(path, "utf-8").trim();
  return instructions.trim();
}

/**
 * One section per box that declares its own policy (design D5).
 *
 * Returns nothing when no box declares one — the common case stays exactly as
 * compact as it was, and the single global section above is the whole policy.
 * When boxes DO differ, a reader of the prompt can tell which surface gets
 * contradictions and which gets narration without opening the config.
 *
 * Only what the box overrides is printed. Anything unstated is inherited from the
 * global policy, and restating it here would invite the two to drift.
 */
export function renderBoxPolicies(cfg: CopilotConfig): string[] {
  const windows = resolveWindows(cfg.wall?.windows ?? [], cfg.wall?.layouts ?? [], () => {});
  const rendered: string[] = [];

  for (const win of windows) {
    for (const box of win.boxes) {
      const policy = box.policy;
      if (!policy) continue;
      const surfaces = box.cats
        .map((c) => cfg.wall?.categories?.find((k) => k.id === c))
        .filter((c): c is NonNullable<typeof c> => Boolean(c));

      const lines: string[] = [
        `### ${win.name} → ${box.position}`,
        "",
        `- Zone: \`${win.zones.join("` / `")}\``,
        `- Renders: ${surfaces.length ? surfaces.map((c) => `${c.icon} \`${c.id}\` (${c.render})`).join(", ") : "—"}`,
      ];
      if (policy.engagement) lines.push(`- Engagement: **${policy.engagement}** (overrides the global setting)`);
      if (policy.maxLines) lines.push(`- Max lines: ${policy.maxLines}`);
      if (policy.alerts?.length) {
        lines.push(`- Alert categories: ${policy.alerts.map((a) => `${a.emoji} ${label(a)}`).join(", ")} (replaces the global list for this box)`);
      }
      if (policy.instructions) {
        lines.push("", boxInstructions(cfg, policy.instructions));
      }
      lines.push("");
      rendered.push(lines.join("\n"));
    }
  }

  if (!rendered.length) return [];
  return [
    "## Per-box policy",
    "",
    "Each box below has its own mandate. Anything a box does not restate is inherited",
    "from the policy above — these are overrides, not replacements.",
    "",
    ...rendered,
  ];
}

/**
 * The full policy block: alert categories, then the wall drawing contract, then any
 * per-box policy, then the project's own instructions. The drawing contract sits here
 * rather than in the skill so it is loaded once and inherited by every producer fork
 * (fork-wall-producer D2).
 */
export function renderCopilotPrompt(cfg: CopilotConfig): string {
  const parts = [renderAlerts(cfg.copilot.alerts, cfg.copilot)];
  // The narration mandate is its own section, gated on `enabled` — so with narration
  // off the alert/engagement policy above is byte-for-byte the pre-change reactive text.
  if (cfg.copilot.narration?.enabled) {
    parts.push(renderNarration(cfg.copilot.narration).join("\n"));
  }
  // The mirroring mandate is its own section, gated on `enabled` — off by default, so the
  // policy above stays byte-for-byte the pre-change text unless a session opts in.
  if (cfg.copilot.mirror?.enabled) {
    parts.push(renderMirror(cfg.copilot.mirror).join("\n"));
  }
  // Tolerate a hand-built config: CopilotConfig is exported, so consumers construct
  // one, and a missing wall/drawing section means "no wall", not a crash.
  if (cfg.copilot.drawing?.enabled) {
    const drawing = renderDrawingContract(
      cfg.wall?.categories ?? [],
      cfg.copilot.drawing.conventions ?? [],
    );
    if (drawing.length) parts.push(drawing.join("\n"));
  }
  const boxes = renderBoxPolicies(cfg);
  if (boxes.length) parts.push(boxes.join("\n"));
  const instructions = readInstructions(cfg);
  if (instructions) parts.push("## Project instructions", "", instructions);
  return parts.join("\n");
}
