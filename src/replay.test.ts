/**
 * The player's pure decisions.
 *
 * Everything asserted here takes the clock as an argument, so the schedule of a
 * 40-minute scenario is checked without waiting 40 minutes for it. The paced playback
 * itself is verified by running the command — this project's testing posture.
 */

import { describe, expect, it } from "vitest";

import { SPEED_MAX, dueAt, latenessOf, parseSpeed, progressLine, rebase, stamp } from "./replay.js";

const START = 1_000_000;

describe("dueAt", () => {
  it("places an entry at its own offset from the run's start", () => {
    expect(dueAt(12_000, START, 1)).toBe(START + 12_000);
  });

  it("computes from the start, never from the previous entry — sleep drift is the whole risk", () => {
    // A 40-minute scenario, entry by entry: every deadline stays anchored to the start,
    // so an accumulating error cannot stretch the run and corrupt its latency figures.
    const offsets = [0, 60_000, 600_000, 1_500_000, 2_400_000];
    for (const ms of offsets) expect(dueAt(ms, START, 1) - START).toBe(ms);
  });

  it("divides by the speed multiplier", () => {
    expect(dueAt(60_000, START, 4)).toBe(START + 15_000);
  });

  it("makes everything due immediately at max speed", () => {
    expect(dueAt(2_400_000, START, SPEED_MAX)).toBe(START);
  });
});

describe("latenessOf", () => {
  it("is zero when the entry is written on time or early", () => {
    expect(latenessOf(10_000, START, 1, START + 10_000)).toBe(0);
    expect(latenessOf(10_000, START, 1, START + 9_000)).toBe(0);
  });

  it("measures how far past its deadline an entry was written", () => {
    expect(latenessOf(10_000, START, 1, START + 12_500)).toBe(2_500);
  });

  it("measures lateness against the sped-up deadline, not the scenario's", () => {
    // At 2x, a 10s entry is due 5s in; writing it at 6s is 1s late, not 4s early.
    expect(latenessOf(10_000, START, 2, START + 6_000)).toBe(1_000);
  });
});

describe("rebase", () => {
  it("moves a relative timestamp onto the run's real clock", () => {
    expect(rebase({ ts: 12_000, speaker: "mic" }, START)).toEqual({ ts: START + 12_000, speaker: "mic" });
  });

  it("moves startTs with ts, so two-channel ordering survives the rebase", () => {
    const out = rebase({ ts: 12_000, startTs: 9_000 }, START);
    expect(out.startTs).toBe(START + 9_000);
    expect((out.ts as number) - (out.startTs as number)).toBe(3_000);
  });

  it("leaves a payload with no timestamps alone", () => {
    expect(rebase({ type: "reconnect" }, START)).toEqual({ type: "reconnect" });
  });

  it("does not mutate its input — the scenario is replayable more than once", () => {
    const input = { ts: 5_000 };
    rebase(input, START);
    expect(input.ts).toBe(5_000);
  });
});

describe("stamp", () => {
  it("renders scenario time as mm:ss", () => {
    expect(stamp(0)).toBe("00:00");
    expect(stamp(9_400)).toBe("00:09");
    expect(stamp(605_000)).toBe("10:05");
  });

  it("renders past an hour without losing minutes", () => {
    expect(stamp(3_845_000)).toBe("64:05");
  });
});

describe("progressLine", () => {
  it("says where the run stands, which section, who speaks, and what is said", () => {
    const out = progressLine({ section: "S04 Program", line: { ts: 65_000, speaker: "mic", text: "Ez a vállalás.", final: true } });
    expect(out).toBe("[01:05] S04 Program · mic: Ez a vállalás.");
  });

  it("names a non-speech event rather than pretending it was spoken", () => {
    expect(progressLine({ event: { type: "silence", ts: 30_000 } })).toBe("[00:30] (silence)");
  });

  it("omits the section when the entry has none", () => {
    expect(progressLine({ line: { ts: 0, speaker: "system", text: "Kérdés?", final: true } }))
      .toBe("[00:00] system: Kérdés?");
  });
});

describe("parseSpeed", () => {
  it("defaults to real time — the only speed that may report latency", () => {
    expect(parseSpeed(undefined)).toBe(1);
  });

  it("accepts a multiplier and the max-speed setting", () => {
    expect(parseSpeed("8")).toBe(8);
    expect(parseSpeed("0")).toBe(SPEED_MAX);
  });

  it("rejects a negative or unparseable speed instead of playing at a guess", () => {
    expect(() => parseSpeed("-2")).toThrow(/invalid --speed/);
    expect(() => parseSpeed("fast")).toThrow(/invalid --speed/);
  });
});
