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

/**
 * Field regression, 2026-10-07: in one meeting the opener fired three times INSIDE a word.
 * Hungarian attaches suffixes directly to the word, and Soniox delivered each of these as
 * `" Copilot"` + a suffix token — so after the first token the buffer ENDED in `copilot`, and
 * end-of-buffer was taken as a word boundary. The recorded spans began with the suffix
 * (`"ot, alapból a…"`, `"okat meg az elmaradt…"`, `"os beállításokat…"`); one of them was even
 * closed and handed to the copilot as a command.
 */
describe("an opener needs a boundary that was actually observed (2026-10-07 field phrases)", () => {
  it("„Meeting Copilotot” — the suffix token continues the word, no command opens", () => {
    const out = feedAll(lane(), [
      " Ehm,", " első", " feladat:", " minden", " projekt,", " amiben", " használunk",
      " Meeting", " Copilot", "ot", ",", " alapból", " a", " Copilot", " transcription", "-ök",
      " be", " kell,", " hogy", " menjenek.", " Most", " csak", " rögzítsd,", " de", " még", " ne", " csináld",
    ]);
    // `Copilot transcription` IS a standalone opener — that one legitimately opens, and the
    // closing word closes it. What must not happen is the suffix `ot` opening a span.
    expect(out.every((e) => e.kind !== "command" || !e.text.startsWith("ot"))).toBe(true);
    expect(out.some((e) => (e.kind === "command" ? e.text : e.partial).startsWith("ot"))).toBe(false);
  });

  it("„Copilotokat” — no command opens", () => {
    const l = lane();
    const out = feedAll(l, [
      " hogy", " beimportáltuk", " az", " elmaradt", " Copilot", "okat", " meg", " az",
      " elmaradt", " diktálásokat.",
    ]);
    expect(out).toEqual([]);
    expect(l.isOpen("mic")).toBe(false);
    expect(l.close(99)).toEqual([]);
  });

  it("„Set Copilotos” — no command opens", () => {
    const l = lane();
    const out = feedAll(l, [
      " rendbe", " tenni", " a", " Set", " Copilot", "os", " beállításokat,", " minden", " projekthez,",
    ]);
    expect(out).toEqual([]);
    expect(l.isOpen("mic")).toBe(false);
    expect(l.close(99)).toEqual([]);
  });

  it("a standalone opener is confirmed by the next word's leading space", () => {
    const out = feedAll(lane(), [" Copilot", " rajzold", " fel", " csináld"]);
    expect(out).toEqual([expect.objectContaining({ kind: "command", text: "rajzold fel" })]);
  });

  it("a standalone opener is confirmed by punctuation", () => {
    const out = feedAll(lane(), [" Copilot", ",", " rajzold", " csináld"]);
    expect(out).toHaveLength(1);
    // The instruction keeps the speaker's own text, punctuation included (unchanged behaviour).
    expect(out[0]).toMatchObject({ kind: "command", text: ", rajzold" });
  });

  it("the span starts where the opener was SAID, not where it was confirmed", () => {
    const l = lane();
    l.feed("mic", " Copilot", 100, 1_000);
    l.feed("mic", " rajzold", 200, 1_100);
    const out = l.feed("mic", " csináld", 300, 1_200);
    expect(out[0]).toMatchObject({ kind: "command", startTs: 100, ts: 300 });
  });

  it("a closer that ends the received speech closes at once — no waiting for the next token", () => {
    const l = lane();
    l.feed("mic", " Copilot rajzold", 1, 1_000);
    const out = l.feed("mic", " csináld", 2, 1_100);
    expect(out).toEqual([expect.objectContaining({ kind: "command", text: "rajzold" })]);
  });

  it("a trimmed pending buffer never starts in the middle of a word", () => {
    // The pending buffer keeps its last 200 characters. Here the cut lands inside
    // `autocopilot` (exactly 200 characters from `copilot` to the end), so the kept tail would
    // begin with `copilot` and "start of buffer" would pass as a word boundary.
    const out = feedAll(lane(), [" auto", "copilot " + "y".repeat(192), " rajzold", " csináld"]);
    expect(out).toEqual([]);
  });
});

describe("chunked backends deliver each chunk as a new word", () => {
  it("a chunk ending in the opener is confirmed by the next chunk's leading space", async () => {
    const { chunkEventText } = await import("./soniox-rt.js");
    expect(chunkEventText("rajzold fel csináld  ")).toBe(" rajzold fel csináld");
    const out = feedAll(lane(), [chunkEventText("Na jó, Copilot"), chunkEventText("rajzold fel csináld")]);
    expect(out).toEqual([expect.objectContaining({ kind: "command", text: "rajzold fel" })]);
  });
});
