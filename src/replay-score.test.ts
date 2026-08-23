/**
 * Scoring.
 *
 * Most of these tests assert a REFUSAL, and that is the point. A regression measure is
 * only useful if it declines to produce a number it cannot justify — a latency from a
 * sped-up run, a coverage figure nobody judged, a comparison across a scenario that
 * changed underneath. Each of those, produced anyway, looks exactly like a result.
 */

import { describe, expect, it } from "vitest";

import type { ReplayRunRecord } from "./replay.js";
import type { Scenario, PlantedMoment } from "./replay-scenario.js";
import {
  compareScorecards, candidatesFor, contentEvents, isDrawn, latencyRefusal, scoreRun,
  type Match, type Scorecard, type WallEventRecord,
} from "./replay-score.js";

const START = 1_700_000_000_000;

const MOMENTS: PlantedMoment[] = [
  { id: "m-q", at: 10_000, kind: "question", expect: "notes the unanswered year" },
  { id: "m-c", at: 30_000, kind: "contradiction", expect: "flags three weeks against six" },
];

function scenario(moments = MOMENTS, fingerprint = "fp1"): Scenario {
  return {
    dir: "/tmp/s", meta: { name: "t", defaultWithinMs: 45_000 },
    script: [{ line: { ts: 40_000, speaker: "mic", text: "vége", final: true } as never }],
    moments, fingerprint, durationMs: 40_000,
  };
}

function record(over: Partial<ReplayRunRecord> = {}): ReplayRunRecord {
  return {
    scenario: "t", fingerprint: "fp1", speed: 1, realTime: true,
    output: "/tmp/t.jsonl", startedAt: START, entries: 1, maxLatenessMs: 0, ...over,
  };
}

const ev = (over: Partial<WallEventRecord> = {}): WallEventRecord =>
  ({ category: "súgás", zone: "both", text: "valami érdemi", emittedAt: START + 12_000, ...over });

function artifacts(events: WallEventRecord[], rec: ReplayRunRecord | null = record(), missing: string[] = []) {
  return { events, record: rec, missing };
}

describe("latencyRefusal", () => {
  it("allows a real-time run whose player kept up", () => {
    expect(latencyRefusal(record())).toBeNull();
  });

  it("refuses a sped-up run — thinking time does not scale with playback", () => {
    expect(latencyRefusal(record({ speed: 8, realTime: false }))).toMatch(/does not scale/);
  });

  it("refuses when the player itself fell behind — that would measure the player", () => {
    expect(latencyRefusal(record({ maxLatenessMs: 9_000 }))).toMatch(/player/);
  });

  it("refuses when there is no run record at all", () => {
    expect(latencyRefusal(null)).toMatch(/no run record/);
  });
});

describe("scoreRun — refusals", () => {
  it("reports coverage as unmeasured, NOT zero, when nobody judged the run", () => {
    const card = scoreRun(scenario(), artifacts([ev()]), []);
    expect(card.dimensions.coverage.measured).toBe(false);
    expect(card.notes.join(" ")).toMatch(/NOT zero/);
  });

  it("reports latency as invalid on a sped-up run while still scoring content", () => {
    const matches: Match[] = [{ momentId: "m-q", eventIndex: 0 }, { momentId: "m-c", eventIndex: null }];
    const card = scoreRun(scenario(), artifacts([ev()], record({ speed: 8, realTime: false })), matches);
    expect(card.dimensions.reactionLatency.measured).toBe(false);
    expect(card.dimensions.coverage.measured).toBe(true);
  });

  it("excludes an unstamped event from latency instead of substituting a time", () => {
    // One stamped event keeps the run measurable; the unstamped one is simply left out
    // of the average rather than counted as zero delay.
    const matches: Match[] = [{ momentId: "m-q", eventIndex: 0 }, { momentId: "m-c", eventIndex: 1 }];
    const events = [ev({ emittedAt: START + 12_000 }), ev({ emittedAt: undefined })];
    const card = scoreRun(scenario(), artifacts(events), matches);
    expect(card.dimensions.coverage.measured).toBe(false);
    expect(card.notes.join(" ")).toMatch(/cannot fall inside/);
  });

  it("does not blame the copilot for an evidence gap — unstamped events make coverage unmeasurable", () => {
    // Caught by scoring a real run recorded before `emittedAt` existed: it read as
    // "0 covered, 3 missed", i.e. a total copilot failure, when in fact the copilot had
    // reacted to every planted moment and the LOG could not say when.
    const matches: Match[] = [{ momentId: "m-q", eventIndex: null }, { momentId: "m-c", eventIndex: null }];
    const card = scoreRun(scenario(), artifacts([ev({ emittedAt: undefined }), ev({ emittedAt: undefined })]), matches);
    expect(card.dimensions.coverage.measured).toBe(false);
    expect(card.dimensions.precision.measured).toBe(false);
    expect(card.missed).toEqual([]);
    expect(card.notes.join(" ")).toMatch(/cannot fall inside any moment's window/);
  });

  it("still scores normally when every event is stamped", () => {
    const matches: Match[] = [{ momentId: "m-q", eventIndex: 0 }, { momentId: "m-c", eventIndex: null }];
    const card = scoreRun(scenario(), artifacts([ev()]), matches);
    expect(card.dimensions.coverage.measured).toBe(true);
    expect(card.missed.map((m) => m.id)).toEqual(["m-c"]);
  });

  it("carries a missing artifact's reason into the notes rather than scoring around it", () => {
    const card = scoreRun(scenario(), artifacts([], null, ["no wall event log — the wall never ran"]), []);
    expect(card.notes.join(" ")).toMatch(/wall never ran/);
  });
});

describe("scoreRun — dimensions", () => {
  const matches: Match[] = [
    { momentId: "m-q", eventIndex: 0 },
    { momentId: "m-c", eventIndex: null },
  ];

  it("credits a covered moment and names a missed one with what was expected", () => {
    const card = scoreRun(scenario(), artifacts([ev()]), matches);
    expect(card.covered).toEqual(["m-q"]);
    expect(card.missed).toEqual([{ id: "m-c", kind: "contradiction", expect: "flags three weeks against six" }]);
    expect(card.dimensions.coverage.measured && card.dimensions.coverage.value).toBe(0.5);
  });

  it("measures reaction latency from when the moment became true", () => {
    const card = scoreRun(scenario(), artifacts([ev({ emittedAt: START + 14_500 })]), matches);
    expect(card.dimensions.reactionLatency).toMatchObject({ measured: true, value: 4_500, unit: "ms" });
  });

  it("counts a reaction with no planted moment behind it against precision", () => {
    // A copilot that reacts to everything scores perfect coverage and is unusable.
    const card = scoreRun(scenario(), artifacts([ev(), ev({ text: "fölösleges" })]), matches);
    expect(card.unmatchedReactions).toBe(1);
    expect(card.dimensions.precision).toMatchObject({ measured: true, value: 0.5 });
  });

  it("counts only the categories the scenario calls reactions", () => {
    // Measured on a real run: continuous narration dragged precision to 0.375 while every
    // planted moment had in fact been answered. A copilot must not be punished for
    // following its own configured policy.
    const s = scenario();
    s.meta.reactionCategories = ["súgás", "riasztás"];
    const events = [ev(), ev({ category: "narráció", text: "folyamatos kommentár" }), ev({ category: "narráció", text: "még egy" })];
    const card = scoreRun(s, artifacts(events), matches);
    expect(card.dimensions.precision).toMatchObject({ measured: true, value: 1 });
    expect(card.unmatchedReactions).toBe(0);
  });

  it("counts every category when the scenario declares none, and says so", () => {
    const events = [ev(), ev({ category: "narráció", text: "kommentár" })];
    const card = scoreRun(scenario(), artifacts(events), matches);
    expect(card.dimensions.precision).toMatchObject({ measured: true, value: 0.5 });
    expect((card.dimensions.precision as { detail: string }).detail).toMatch(/every category counted/);
  });

  it("records the judged matching per moment, with its delay and the judge's reasoning", () => {
    // A judged verdict is not reproducible, so it has to be kept. Without it a reader
    // reconstructs the matching from the window — which is a DIFFERENT number, and on a
    // real run the two disagreed by a factor of two.
    const withReasons: Match[] = [
      { momentId: "m-q", eventIndex: 0, reasoning: "kimondja, hogy az évszám nyitva maradt" },
      { momentId: "m-c", eventIndex: null, reasoning: "semmi nem hozza szóba a hat hetet" },
    ];
    const card = scoreRun(scenario(), artifacts([ev({ emittedAt: START + 13_500 })]), withReasons);
    expect(card.judgement).toEqual([
      { momentId: "m-q", kind: "question", eventIndex: 0, delayMs: 3_500, reasoning: "kimondja, hogy az évszám nyitva maradt" },
      { momentId: "m-c", kind: "contradiction", eventIndex: null, delayMs: null, reasoning: "semmi nem hozza szóba a hat hetet" },
    ]);
  });

  it("reports no delay for a moment whose run may not claim latency", () => {
    const withReasons: Match[] = [{ momentId: "m-q", eventIndex: 0 }, { momentId: "m-c", eventIndex: null }];
    const card = scoreRun(scenario(), artifacts([ev()], record({ speed: 8, realTime: false })), withReasons);
    expect(card.judgement[0].delayMs).toBeNull();
    expect(card.judgement[0].eventIndex).toBe(0);
  });

  it("counts drawn payloads separately from text", () => {
    const card = scoreRun(scenario(), artifacts([ev(), ev({ text: undefined, graph: { op: "add", nodes: [] } })]), matches);
    expect(card.dimensions.draws).toMatchObject({ measured: true, value: 1 });
  });

  it("measures filler share against the shipped phrase list", () => {
    const card = scoreRun(scenario(), artifacts([ev({ text: "Rendben." }), ev({ text: "A pilot három hét." })]), matches);
    expect(card.dimensions.fillerShare).toMatchObject({ measured: true, value: 0.5 });
  });

  it("counts a staged prediction that expired unused against the prediction ratio", () => {
    const events = [
      ev({ staged: true, visual: "v1", zone: "private" }),
      ev({ staged: true, visual: "v2", zone: "private" }),
      { promote: { visual: "v1", category: "súgás" } } as WallEventRecord,
    ];
    const card = scoreRun(scenario(), artifacts(events), matches);
    expect(card.dimensions.predictionsStaged).toMatchObject({ value: 2 });
    expect(card.dimensions.predictionsPromoted).toMatchObject({ measured: true, value: 0.5 });
  });

  it("reports the prediction ratio as unmeasured when nothing was staged", () => {
    const card = scoreRun(scenario(), artifacts([ev()]), matches);
    expect(card.dimensions.predictionsPromoted.measured).toBe(false);
  });
});

describe("contentEvents / isDrawn / candidatesFor", () => {
  it("does not count a promote command as wall content — it names a visual, it is not one", () => {
    expect(contentEvents([ev(), { promote: { visual: "v1" } }])).toHaveLength(1);
  });

  it("recognises every drawn payload type", () => {
    expect(isDrawn({ graph: {} })).toBe(true);
    expect(isDrawn({ chart: {} })).toBe(true);
    expect(isDrawn({ image: {} })).toBe(true);
    expect(isDrawn({ webpage: {} })).toBe(true);
    expect(isDrawn(ev())).toBe(false);
  });

  it("narrows a judge's candidates to the moment's own window", () => {
    const events = [
      ev({ emittedAt: START + 5_000 }),   // before the moment
      ev({ emittedAt: START + 12_000 }),  // inside
      ev({ emittedAt: START + 90_000 }),  // long after
    ];
    const got = candidatesFor(MOMENTS[0], events, record(), 45_000);
    expect(got.map((c) => c.index)).toEqual([1]);
  });

  it("honours a moment's own window over the scenario default", () => {
    const events = [ev({ emittedAt: START + 20_000 })];
    expect(candidatesFor({ ...MOMENTS[0], withinMs: 5_000 }, events, record(), 45_000)).toHaveLength(0);
    expect(candidatesFor({ ...MOMENTS[0], withinMs: 30_000 }, events, record(), 45_000)).toHaveLength(1);
  });
});

describe("compareScorecards", () => {
  const card = (over: Partial<Scorecard> = {}): Scorecard => ({
    scenario: "t", fingerprint: "fp1", speed: 1, realTime: true,
    covered: [], missed: [], unmatchedReactions: 0, notes: [],
    dimensions: {
      coverage: { measured: true, source: "judged", value: 0.5, unit: "ratio" },
      reactionLatency: { measured: true, source: "computed", value: 5_000, unit: "ms" },
      fillerShare: { measured: true, source: "computed", value: 0.2, unit: "ratio" },
      draws: { measured: true, source: "computed", value: 3, unit: "count" },
    },
    ...over,
  });

  it("refuses any verdict when the scenario itself changed", () => {
    const out = compareScorecards(card(), card({ fingerprint: "fp2" }));
    expect(out.comparable).toBe(false);
    expect(out.refusal).toMatch(/scenario itself changed/);
  });

  it("calls a higher coverage an improvement", () => {
    const after = card();
    after.dimensions.coverage = { measured: true, source: "judged", value: 0.9, unit: "ratio" };
    expect(compareScorecards(card(), after).dimensions.coverage.direction).toBe("improved");
  });

  it("calls a higher latency a regression — lower is better there", () => {
    const after = card();
    after.dimensions.reactionLatency = { measured: true, source: "computed", value: 9_000, unit: "ms" };
    expect(compareScorecards(card(), after).dimensions.reactionLatency.direction).toBe("regressed");
  });

  it("calls more filler a regression", () => {
    const after = card();
    after.dimensions.fillerShare = { measured: true, source: "computed", value: 0.4, unit: "ratio" };
    expect(compareScorecards(card(), after).dimensions.fillerShare.direction).toBe("regressed");
  });

  it("refuses to compare latency across mismatched speeds but still compares content", () => {
    const out = compareScorecards(card(), card({ speed: 8, realTime: false }));
    expect(out.comparable).toBe(true);
    expect(out.dimensions.reactionLatency.direction).toBe("unmeasurable");
    expect(out.dimensions.coverage.direction).toBe("unchanged");
  });

  it("calls a difference inside the measured noise band unchanged, not a regression", () => {
    // The failure this exists to prevent, measured: two runs of one scenario with nothing
    // changed moved coverage 0.857 → 0.571, and the comparison called it a regression.
    const after = card();
    after.dimensions.coverage = { measured: true, source: "judged", value: 0.42, unit: "ratio" };
    const out = compareScorecards(card(), after, { coverage: 0.2 });
    expect(out.dimensions.coverage.direction).toBe("unchanged");
    expect(out.dimensions.coverage.note).toMatch(/noise band/);
  });

  it("still calls a difference beyond the band what it is", () => {
    const after = card();
    after.dimensions.coverage = { measured: true, source: "judged", value: 0.95, unit: "ratio" };
    const out = compareScorecards(card(), after, { coverage: 0.2 });
    expect(out.dimensions.coverage.direction).toBe("improved");
  });

  it("says so when no band is declared — a single-run difference is a reading, not evidence", () => {
    const after = card();
    after.dimensions.coverage = { measured: true, source: "judged", value: 0.42, unit: "ratio" };
    const out = compareScorecards(card(), after);
    expect(out.dimensions.coverage.direction).toBe("regressed");
    expect(out.dimensions.coverage.note).toMatch(/not evidence/);
  });

  it("applies the band to a lower-is-better dimension too", () => {
    const after = card();
    after.dimensions.fillerShare = { measured: true, source: "computed", value: 0.24, unit: "ratio" };
    expect(compareScorecards(card(), after, { fillerShare: 0.06 }).dimensions.fillerShare.direction).toBe("unchanged");
  });

  it("reports an activity count without grading it", () => {
    const after = card();
    after.dimensions.draws = { measured: true, source: "computed", value: 12, unit: "count" };
    const out = compareScorecards(card(), after);
    expect(out.dimensions.draws.direction).toBe("unchanged");
    expect(out.dimensions.draws.note).toMatch(/not graded/);
  });

  it("carries the reason forward when either side was unmeasured", () => {
    const before = card();
    before.dimensions.coverage = { measured: false, reason: "no judged matching supplied" };
    const out = compareScorecards(before, card());
    expect(out.dimensions.coverage.direction).toBe("unmeasurable");
    expect(out.dimensions.coverage.note).toMatch(/no judged matching/);
  });
});
