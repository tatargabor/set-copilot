/**
 * The judged step.
 *
 * The prompt and the parse are tested; the spawn is not, deliberately — it is three
 * lines around them. What matters is that a judge cannot widen the window the scenario
 * declared, and that an unanswered moment is recorded as unanswered rather than as a
 * copilot failure. Both are ways a score could drift without the copilot changing.
 */

import { describe, expect, it } from "vitest";

import type { ReplayRunRecord } from "./replay.js";
import type { PlantedMoment, Scenario } from "./replay-scenario.js";
import type { WallEventRecord } from "./replay-score.js";
import { judgePrompt, judgeQuestions, parseJudgeReply } from "./replay-judge.js";

const START = 1_700_000_000_000;

const MOMENTS: PlantedMoment[] = [
  { id: "m-q", at: 10_000, kind: "question", expect: "notes the unanswered year" },
  { id: "m-c", at: 30_000, kind: "contradiction", expect: "flags three weeks against six" },
];

const scenario: Scenario = {
  dir: "/tmp/s", meta: { name: "t", defaultWithinMs: 20_000 },
  script: [{ line: { ts: 40_000, speaker: "mic", text: "vége", final: true } as never }],
  moments: MOMENTS, fingerprint: "fp1", durationMs: 40_000,
};

const record: ReplayRunRecord = {
  scenario: "t", fingerprint: "fp1", speed: 1, realTime: true,
  output: "/tmp/t.jsonl", startedAt: START, entries: 1, maxLatenessMs: 0,
};

const EVENTS: WallEventRecord[] = [
  { category: "súgás", text: "❓ Az évszám nyitva maradt.", emittedAt: START + 14_000 },
  { category: "architektúra", graph: { op: "add", nodes: [] }, emittedAt: START + 16_000 },
  { category: "riasztás", text: "⚠ Három hét vs hat hét.", emittedAt: START + 35_000 },
  { category: "súgás", text: "késői", emittedAt: START + 300_000 },
];

describe("judgeQuestions", () => {
  it("asks one question per planted moment, carrying what it expected", () => {
    const qs = judgeQuestions(scenario, EVENTS, record);
    expect(qs.map((q) => q.momentId)).toEqual(["m-q", "m-c"]);
    expect(qs[1].expect).toBe("flags three weeks against six");
  });

  it("offers only the candidates inside each moment's window", () => {
    const qs = judgeQuestions(scenario, EVENTS, record);
    expect(qs[0].candidates.map((c) => c.index)).toEqual([0, 1]);
    expect(qs[1].candidates.map((c) => c.index)).toEqual([2]);
  });

  it("names a payload in one word rather than showing the judge a whole graph", () => {
    const qs = judgeQuestions(scenario, EVENTS, record);
    expect(qs[0].candidates.find((c) => c.index === 1)?.payload).toBe("graph");
    expect(qs[0].candidates.find((c) => c.index === 0)?.payload).toBe("text");
  });

  it("truncates a long text so one verbose event cannot dominate the prompt", () => {
    const long = [{ category: "súgás", text: "x".repeat(2000), emittedAt: START + 12_000 }];
    const qs = judgeQuestions(scenario, long, record);
    expect((qs[0].candidates[0].text as string).length).toBe(400);
  });
});

describe("judgePrompt", () => {
  it("tells the judge to default to no match when unsure", () => {
    expect(judgePrompt(judgeQuestions(scenario, EVENTS, record))).toMatch(/Default to null when unsure/);
  });

  it("forbids reaching for an unlisted event", () => {
    expect(judgePrompt(judgeQuestions(scenario, EVENTS, record))).toMatch(/never reach for it/);
  });

  it("says that being on the same topic is not enough", () => {
    expect(judgePrompt(judgeQuestions(scenario, EVENTS, record))).toMatch(/merely on the same topic/);
  });
});

describe("parseJudgeReply", () => {
  const qs = judgeQuestions(scenario, EVENTS, record);

  it("reads a plain JSON reply", () => {
    const out = parseJudgeReply('{"matches":[{"momentId":"m-q","eventIndex":0,"reasoning":"jó"}]}', qs);
    expect(out.find((m) => m.momentId === "m-q")).toMatchObject({ eventIndex: 0, reasoning: "jó" });
  });

  it("reads a reply wrapped in prose or a fence", () => {
    const out = parseJudgeReply('Íme:\n```json\n{"matches":[{"momentId":"m-c","eventIndex":2}]}\n```\nkész', qs);
    expect(out.find((m) => m.momentId === "m-c")?.eventIndex).toBe(2);
  });

  it("discards an index the judge was never offered — a judge may not widen the window", () => {
    const out = parseJudgeReply('{"matches":[{"momentId":"m-q","eventIndex":3}]}', qs);
    expect(out.find((m) => m.momentId === "m-q")?.eventIndex).toBeNull();
  });

  it("ignores a moment id that is not in the scenario", () => {
    const out = parseJudgeReply('{"matches":[{"momentId":"nincs-ilyen","eventIndex":0}]}', qs);
    expect(out.some((m) => m.momentId === "nincs-ilyen")).toBe(false);
  });

  it("records an unanswered moment as unanswered, not as a copilot failure", () => {
    const out = parseJudgeReply('{"matches":[{"momentId":"m-q","eventIndex":0}]}', qs);
    const skipped = out.find((m) => m.momentId === "m-c");
    expect(skipped?.eventIndex).toBeNull();
    expect(skipped?.reasoning).toMatch(/did not answer/);
  });

  it("answers for every moment, whatever the judge returned", () => {
    expect(parseJudgeReply('{"matches":[]}', qs).map((m) => m.momentId).sort()).toEqual(["m-c", "m-q"]);
  });

  it("throws on a reply with no JSON at all rather than scoring an empty judgement", () => {
    expect(() => parseJudgeReply("Nem tudom megmondani.", qs)).toThrow(/no JSON/);
  });

  it("throws when the JSON carries no matches array", () => {
    expect(() => parseJudgeReply('{"verdict":"ok"}', qs)).toThrow(/matches/);
  });
});
