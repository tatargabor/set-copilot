/**
 * The judged half of scoring: did a reaction actually ADDRESS a planted moment?
 *
 * Kept in its own module because it is the one part of a score that is not
 * deterministic. The mechanical dimensions must be identical on every run of the same
 * artifacts — that is what makes a regression measure a measure — so a verdict never
 * reaches them except through an explicit matching, which this produces.
 *
 * The judge is asked a narrow question about pre-narrowed candidates. Handing it the
 * whole event log would make it re-derive the timeline on every question, and a judge
 * that reconstructs its own context answers a slightly different question each time.
 *
 * Its reasoning is recorded with its verdict, so a disputed score can be inspected
 * rather than merely re-run — re-running a non-deterministic step to check it is how a
 * disagreement becomes a coin flip.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ReplayRunRecord } from "./replay.js";
import type { Scenario } from "./replay-scenario.js";
import { candidatesFor, type Match, type WallEventRecord } from "./replay-score.js";

const run = promisify(execFile);

/** How long a judged reaction may lag its moment when the scenario says nothing. */
export const DEFAULT_WITHIN_MS = 45_000;

/** One question put to the judge: a moment, and the reactions that could plausibly be it. */
export interface JudgeQuestion {
  momentId: string;
  kind: string;
  expect: string;
  candidates: { index: number; category?: string; text?: string; payload: string }[];
}

/** What a candidate carries, in one word, so the judge is not shown a whole graph. */
function payloadKind(e: WallEventRecord): string {
  for (const k of ["graph", "chart", "image", "webpage"] as const) if (e[k] !== undefined) return k;
  return e.text !== undefined ? "text" : "none";
}

/** Build the questions for a run. Pure — the prompt is asserted in tests, not guessed at. */
export function judgeQuestions(
  scenario: Scenario,
  events: WallEventRecord[],
  record: ReplayRunRecord,
): JudgeQuestion[] {
  const within = scenario.meta.defaultWithinMs ?? DEFAULT_WITHIN_MS;
  return scenario.moments.map((m) => ({
    momentId: m.id,
    kind: m.kind,
    expect: m.expect,
    candidates: candidatesFor(m, events, record, within).map(({ index, event }) => ({
      index,
      category: event.category,
      text: typeof event.text === "string" ? event.text.slice(0, 400) : undefined,
      payload: payloadKind(event),
    })),
  }));
}

/**
 * The judge's prompt.
 *
 * Two instructions carry it. It must answer per moment, from the candidates only — an
 * unlisted event is outside the moment's window and matching it would silently widen the
 * window the scenario declared. And it must default to "no match" when unsure: a scoring
 * judge that resolves doubt in the copilot's favour turns every borderline reaction into
 * credit, and the score drifts upward without the copilot changing at all.
 */
export function judgePrompt(questions: JudgeQuestion[]): string {
  return [
    "You are scoring a recorded meeting-copilot run. For each planted moment below you are given",
    "the wall events that appeared inside that moment's time window.",
    "",
    "For EACH moment, decide whether one of its candidates actually ADDRESSES what the moment expected.",
    "",
    "Rules:",
    '  - Answer only from the listed candidates. An event not listed is outside the window; never reach for it.',
    '  - If no candidate addresses the moment, answer eventIndex: null. Default to null when unsure —',
    "    resolving doubt in the copilot's favour makes every borderline reaction count as credit.",
    "  - A reaction that is merely on the same topic does not address the moment. It must do what",
    '    "expect" describes.',
    "  - If SEVERAL candidates address the moment, pick the EARLIEST (lowest index) as eventIndex.",
    "    Reaction latency means when the copilot FIRST addressed it; a later restatement inflates the",
    "    figure. Measured: re-judging one unchanged run moved its latency 36.0s to 40.3s purely by",
    "    matching a later event.",
    "  - Then list EVERY OTHER candidate that also addresses this moment in `alsoAddressing`, and",
    "    nothing else. This is not a second chance at the match: it is how precision tells a follow-up",
    "    on an answered moment apart from a reaction to nothing. Empty array when there are none, and",
    "    apply the same strictness — same topic is not addressing.",
    "  - Give one short sentence of reasoning per moment. It is recorded with the verdict.",
    "",
    "Reply with JSON only, no prose around it:",
    '{"matches":[{"momentId":"...","eventIndex":0,"alsoAddressing":[3,7],"reasoning":"..."}]}',
    "",
    "Moments:",
    JSON.stringify(questions, null, 1),
  ].join("\n");
}

/** Parse a judge's reply into matches, tolerating a fenced block around the JSON. */
export function parseJudgeReply(reply: string, questions: JudgeQuestion[]): Match[] {
  const known = new Set(questions.map((q) => q.momentId));
  const valid = new Map(questions.map((q) => [q.momentId, new Set(q.candidates.map((c) => c.index))]));

  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("judge reply contained no JSON object");
  const parsed = JSON.parse(reply.slice(start, end + 1)) as { matches?: unknown };
  if (!Array.isArray(parsed.matches)) throw new Error("judge reply has no `matches` array");

  const out: Match[] = [];
  for (const raw of parsed.matches) {
    const m = raw as Match;
    if (typeof m?.momentId !== "string" || !known.has(m.momentId)) continue;
    // An index the judge was never offered is discarded rather than trusted: honouring it
    // would silently widen the window the scenario declared.
    const index = typeof m.eventIndex === "number" && valid.get(m.momentId)?.has(m.eventIndex)
      ? m.eventIndex
      : null;
    // Same rule as the credited index: an index the judge was never offered is discarded,
    // and the credited one is not repeated here — `alsoAddressing` means "the OTHERS".
    const offered = valid.get(m.momentId);
    const also = Array.isArray(m.alsoAddressing)
      ? [...new Set(m.alsoAddressing.filter((i): i is number => typeof i === "number" && offered!.has(i) && i !== index))]
      : undefined;
    out.push({ momentId: m.momentId, eventIndex: index, alsoAddressing: also, reasoning: typeof m.reasoning === "string" ? m.reasoning : undefined });
  }
  // A moment the judge skipped is an unjudged moment, not a missed one — recorded as no
  // match, with the reason said out loud rather than looking like a copilot failure.
  for (const q of questions) {
    if (!out.some((m) => m.momentId === q.momentId)) {
      out.push({ momentId: q.momentId, eventIndex: null, reasoning: "the judge did not answer for this moment" });
    }
  }
  return out;
}

/** Ask a headless session to judge. Thin on purpose — the prompt and the parse are tested. */
export async function askJudge(questions: JudgeQuestion[], bin = "claude"): Promise<Match[]> {
  const { stdout } = await run(bin, ["-p", judgePrompt(questions)], { maxBuffer: 8 * 1024 * 1024 });
  return parseJudgeReply(stdout, questions);
}
