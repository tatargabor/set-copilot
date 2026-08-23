/**
 * The fast lane.
 *
 * Most of these tests feed speech in PIECES, because that is how it arrives: Soniox
 * emits tokens, and the transcript writer cuts lines on rules that know nothing about
 * where an instruction starts. A matcher that only works on tidy whole sentences works
 * in a test file and nowhere else.
 */

import { describe, expect, it } from "vitest";

import { FastLane, type FastLaneConfig } from "./fast-lane.js";

const CFG: FastLaneConfig = {
  enabled: true,
  start: ["copilot", "start"],
  end: ["csináld", "stop"],
  maxSpanMs: 30_000,
  maxChars: 600,
};

const lane = (over: Partial<FastLaneConfig> = {}) => new FastLane({ ...CFG, ...over });

/** Feed a whole utterance in fragments and collect everything the lane emitted. */
function feedAll(l: FastLane, pieces: string[], t0 = 1_000, now = 5_000) {
  return pieces.flatMap((p, i) => l.feed("mic", p, t0 + i, now));
}

describe("a bracketed command", () => {
  it("hands over only what was said BETWEEN the markers", () => {
    const out = feedAll(lane(), [" Copilot", " rajzold meg az ábrát", " csináld"]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "command", speaker: "mic", text: "rajzold meg az ábrát" });
  });

  it("works when both markers arrive in one piece", () => {
    const out = feedAll(lane(), ["START mutasd a számokat STOP"]);
    expect(out[0]).toMatchObject({ kind: "command", text: "mutasd a számokat" });
  });

  it("survives a marker split across fragments — the whole reason it reads tokens", () => {
    // "CSINÁLD" arriving as "CSI" + "NÁLD" is invisible to any line-level matcher.
    const out = feedAll(lane(), [" Copi", "lot", " rajzolj egy gráfot", " csi", "náld"]);
    expect(out[0]).toMatchObject({ kind: "command", text: "rajzolj egy gráfot" });
  });

  it("keeps the speaker's own accents in the instruction while matching without them", () => {
    const out = feedAll(lane(), ["copilot", " írd össze a döntéseket", " CSINALD"]);
    expect(out[0]).toMatchObject({ text: "írd össze a döntéseket" });
  });

  it("ignores a marker inside a longer word", () => {
    // "restart" must not open a command, "stopper" must not close one.
    const out = feedAll(lane(), ["a restart után a stopper elindult."]);
    expect(out).toEqual([]);
  });

  it("does not fire on the opening word alone — both words, in order", () => {
    expect(feedAll(lane(), ["Copilot, szerintem ez jó lesz."])).toEqual([]);
  });

  it("takes a command from the system channel too — the marker is explicit", () => {
    const l = lane();
    expect(l.feed("system", "copilot foglald össze csináld", 1, 5)).toHaveLength(1);
  });
});

describe("an unterminated command dies out loud", () => {
  it("abandons on the time cap, reporting what it had", () => {
    const l = lane({ maxSpanMs: 10_000 });
    expect(l.feed("mic", "copilot rajzolj", 1, 1_000)).toEqual([]);
    const out = l.feed("mic", " valamit", 2, 20_000);
    expect(out[0]).toMatchObject({ kind: "abandoned", reason: "timeout", partial: "rajzolj valamit" });
  });

  it("abandons on the length cap, so a meeting cannot become one instruction", () => {
    const l = lane({ maxChars: 40 });
    l.feed("mic", "copilot", 1, 1_000);
    const out = l.feed("mic", " " + "szó ".repeat(20), 2, 1_100);
    expect(out[0]).toMatchObject({ kind: "abandoned", reason: "too-long" });
  });

  it("reports an open span when the capture ends mid-instruction", () => {
    const l = lane();
    l.feed("mic", "copilot mutasd meg", 1, 1_000);
    expect(l.close(9)).toEqual([
      { kind: "abandoned", speaker: "mic", partial: "mutasd meg", reason: "timeout", startTs: 1, ts: 9 },
    ]);
  });

  it("goes quiet again after abandoning — the next words are not the instruction", () => {
    const l = lane({ maxSpanMs: 10 });
    l.feed("mic", "copilot", 1, 1_000);
    l.feed("mic", " hagyjuk", 2, 5_000);
    expect(l.isOpen("mic")).toBe(false);
    expect(l.feed("mic", " teljesen más téma csináld", 3, 6_000)).toEqual([]);
  });
});

describe("channels and state", () => {
  it("keeps the two channels' spans apart", () => {
    const l = lane();
    l.feed("mic", "copilot rajzolj", 1, 1_000);
    expect(l.feed("system", " csináld", 2, 1_100)).toEqual([]); // not the mic's terminator
    expect(l.isOpen("mic")).toBe(true);
    expect(l.feed("mic", " csináld", 3, 1_200)).toHaveLength(1);
  });

  it("a second opener inside an open span is part of the instruction, not a restart", () => {
    // "copilot" said again mid-instruction is speech, not a new trigger: restarting
    // there would silently drop everything the speaker had already said.
    const out = feedAll(lane(), ["copilot", " mondd meg a copilot nevét", " stop"]);
    expect(out[0]).toMatchObject({ text: "mondd meg a copilot nevét" });
  });

  it("emits nothing at all when the lane is disabled", () => {
    expect(feedAll(lane({ enabled: false }), ["copilot rajzolj csináld"])).toEqual([]);
  });
});
