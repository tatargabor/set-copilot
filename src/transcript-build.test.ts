import { describe, expect, it } from "vitest";

import { DEFAULT_COMPLETE_WORDS } from "./config.js";
import { parseLines, stitchText, stitchTranscript, type StitchLine } from "./transcript-build.js";

const OPTS = { completeWords: DEFAULT_COMPLETE_WORDS, pauseGapMs: 2500 };

const jsonl = (rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

/**
 * The failure shape this change exists to undo, rebuilt SYNTHETICALLY: one `system`
 * utterance the writer cut into six fragments — twice mid-word — with `mic` backchannel
 * interleaved between them. No client recording may enter the repo (docs/PRE-PUBLISH.md),
 * so the sentence is invented; only the boundary shape is reproduced.
 */
const SIX_FRAGMENTS: unknown[] = [
  { ts: 56520, startTs: 54000, speaker: "system", text: "cuccot, mert ugye nekünk Google Drive-on", final: true, partial: true },
  { ts: 57000, speaker: "mic", text: "Aha.", final: true },
  { ts: 58560, startTs: 57200, speaker: "system", text: "több gigányi ir", final: true, partial: true, cont: true },
  { ts: 59000, speaker: "mic", text: "Mhm.", final: true },
  { ts: 60540, startTs: 59100, speaker: "system", text: "at, doksi van összehalmozva,", final: true, partial: true, cont: true, midWord: true },
  { ts: 62520, startTs: 60900, speaker: "system", text: "hogy teljesen vegyesen, teh", final: true, partial: true, cont: true },
  { ts: 63000, speaker: "mic", text: "Igen, értem.", final: true },
  { ts: 64560, startTs: 62800, speaker: "system", text: "át így az árajánlattól a speci", final: true, partial: true, cont: true, midWord: true },
  { ts: 66180, startTs: 64800, speaker: "system", text: "fikációig, izé, minden.", final: true, cont: true, midWord: true },
];

/** The same six fragments as a pre-`a30d12f` recording: no cont/midWord/startTs at all. */
const legacy = (rows: unknown[]): unknown[] =>
  rows.map((r) => {
    const { cont, midWord, startTs, ...rest } = r as Record<string, unknown>;
    void cont; void midWord; void startTs;
    return rest;
  });

describe("the six fragments become one sentence", () => {
  const result = stitchText(jsonl(SIX_FRAGMENTS), OPTS)!;
  const system = result.sentences.filter((s) => s.speaker === "system");

  it("produces exactly ONE system sentence out of six lines", () => {
    expect(system).toHaveLength(1);
  });

  it("joins the mid-word cuts with NO separator", () => {
    expect(system[0]!.text).toContain("specifikációig");
    expect(system[0]!.text).toContain("irat");
    expect(system[0]!.text).toContain("tehát");
    expect(system[0]!.text).not.toContain("speci fikációig");
  });

  it("joins the word-boundary cut with a single space", () => {
    expect(system[0]!.text).toContain("Drive-on több");
  });

  it("keeps the interleaved backchannel as separate mic sentences", () => {
    expect(result.sentences.filter((s) => s.speaker === "mic").map((s) => s.text)).toEqual([
      "Aha.",
      "Mhm.",
      "Igen, értem.",
    ]);
  });

  it("guesses NOTHING when the capture recorded the boundaries", () => {
    expect(result.stats.guessed).toBe(0);
    expect(result.stats.exact).toBe(5);
    expect(system[0]!.exact).toBe(true);
  });
});

describe("false sentence terminators (the recognizer's own mis-punctuation)", () => {
  const one = (text: string): string[] =>
    stitchText(jsonl([{ ts: 1000, speaker: "mic", text }]), OPTS)!.sentences.map((s) => s.text);

  it("does not split where a lowercase word follows the period", () => {
    // Soniox drops periods mid-utterance; splitting there rebuilds the very fragments
    // the stitch exists to remove.
    expect(one("hm, dehogy. ma már volt egy sessionünk.")).toEqual([
      "hm, dehogy. ma már volt egy sessionünk.",
    ]);
  });

  it("still splits at a real sentence start", () => {
    expect(one("Ez az első. Ez a második.")).toEqual(["Ez az első.", "Ez a második."]);
    expect(one("Kérdés? Igen! Vége.")).toEqual(["Kérdés?", "Igen!", "Vége."]);
  });

  it("treats a digit or a quote as a real sentence start", () => {
    expect(one('Az ár. 3000 forint.')).toEqual(["Az ár.", "3000 forint."]);
    expect(one('Azt mondta. "Persze."')).toEqual(["Azt mondta.", '"Persze."']);
  });

  it("keeps the terminator — it changes where a sentence is CUT, not what it says", () => {
    expect(one("dehogy. ma").join("")).toContain("dehogy. ma");
  });

  it("never merges a case-less script into one blob", () => {
    // Chinese is \p{Lo}, not \p{Ll} — a "not uppercase" rule would swallow the lot.
    expect(one("这是第一句。这是第二句。").length).toBeGreaterThan(0);
    expect(one("First. 这是第一句. Third.")).toEqual(["First.", "这是第一句.", "Third."]);
  });
});

describe("the heuristic fallback (recordings without cont/midWord)", () => {
  it("has to guess, and marks the sentence as not-exact", () => {
    const result = stitchText(jsonl(legacy(SIX_FRAGMENTS)), OPTS)!;
    expect(result.stats.guessed).toBeGreaterThan(0);
    expect(result.sentences.find((s) => s.speaker === "system")!.exact).toBe(false);
  });

  it("still heals the mid-word cut it has no evidence for", () => {
    const result = stitchText(jsonl(legacy(SIX_FRAGMENTS)), OPTS)!;
    // "speci" + "fikációig": ends in a letter, resumes lowercase, short pause, neither
    // half is a complete word — the only case the heuristic glues.
    expect(result.sentences.find((s) => s.speaker === "system")!.text).toContain("specifikációig");
  });

  const twoFragments = (a: string, b: string, gapMs: number): string =>
    jsonl([
      { ts: 1000, speaker: "mic", text: a, final: true },
      { ts: 1000 + gapMs, speaker: "mic", text: b, final: true },
    ]);

  it("a complete function word on either side forces a space", () => {
    const r = stitchText(twoFragments("a doksi van", "összehalmozva.", 500), OPTS)!;
    expect(r.sentences[0]!.text).toBe("a doksi van összehalmozva.");
  });

  it("a pause of at least pauseGapMs forces a space", () => {
    // Without the pause rule these two would glue: both halves look like word fragments.
    expect(stitchText(twoFragments("szerkeszten", "dobozka.", 3000), OPTS)!.sentences[0]!.text).toBe(
      "szerkeszten dobozka.",
    );
    expect(stitchText(twoFragments("szerkeszten", "dobozka.", 500), OPTS)!.sentences[0]!.text).toBe(
      "szerkesztendobozka.",
    );
  });

  it("a capitalised or numeric continuation is never glued", () => {
    expect(stitchText(twoFragments("szerkeszten", "Dobozka.", 500), OPTS)!.sentences[0]!.text).toBe(
      "szerkeszten Dobozka.",
    );
    expect(stitchText(twoFragments("szerkeszten", "3 dobozka.", 500), OPTS)!.sentences[0]!.text).toBe(
      "szerkeszten 3 dobozka.",
    );
  });

  it("an empty completeWords list means 'never guess' — every unmarked join takes a space", () => {
    const r = stitchText(jsonl(legacy(SIX_FRAGMENTS)), { completeWords: [], pauseGapMs: 0 })!;
    expect(r.sentences.find((s) => s.speaker === "system")!.text).toContain("speci fikációig");
    expect(r.stats.healed).toBe(0);
  });

  it("matches accented words as whole words (Unicode boundaries, not \\b)", () => {
    // "illetve" is in the list; if `\b` or a Latin-only class were used, the accented
    // neighbour would break the match and the pair would glue.
    const r = stitchText(twoFragments("végül illetve", "árajánlat.", 500), OPTS)!;
    expect(r.sentences[0]!.text).toBe("végül illetve árajánlat.");
  });
});

describe("ordering across two channels", () => {
  it("sorts on startTs, not on completion time", () => {
    const r = stitchText(
      jsonl([
        { ts: 5000, speaker: "mic", text: "Rövid közbeszólás.", final: true, startTs: 4800 },
        { ts: 8000, speaker: "mic", text: "Még egy.", final: true, startTs: 7800 },
        // Started FIRST, completed LAST — completion order would put it at the end.
        { ts: 20000, startTs: 1000, speaker: "system", text: "Egy hosszú megszólalás.", final: true },
      ]),
      OPTS,
    )!;
    expect(r.sentences.map((s) => s.speaker)).toEqual(["system", "mic", "mic"]);
  });

  it("falls back to ts when startTs is absent (pre-a30d12f recordings)", () => {
    const r = stitchText(
      jsonl([
        { ts: 2000, speaker: "system", text: "Első." },
        { ts: 1000, speaker: "mic", text: "Korábbi." },
      ]),
      OPTS,
    )!;
    expect(r.sentences.map((s) => s.text)).toEqual(["Korábbi.", "Első."]);
  });

  it("marks overlapping speech and maps speaker names from config", () => {
    const r = stitchText(
      jsonl([
        { ts: 10000, startTs: 1000, speaker: "system", text: "Hosszan beszélek." },
        { ts: 5000, startTs: 4000, speaker: "mic", text: "Közbevágok." },
      ]),
      { ...OPTS, speakers: { mic: "Gábor" } },
    )!;
    expect(r.sentences.every((s) => s.overlap)).toBe(true);
    expect(r.markdown).toContain("Gábor ⇄");
    // An unmapped channel falls back to its raw name rather than vanishing.
    expect(r.markdown).toContain("system ⇄");
  });
});

describe("capture rotation", () => {
  const rotated = jsonl([
    { ts: 100_000, speaker: "mic", text: "Első szakasz." },
    { ts: 120_000, speaker: "mic", text: "Még mindig az első." },
    { ts: 500, speaker: "mic", text: "A rotáció utáni rész." },
    { ts: 4000, speaker: "mic", text: "És a vége." },
  ]);

  it("does not let the second segment jump back to the start of the meeting", () => {
    const r = stitchText(rotated, OPTS)!;
    // The real assertion is that the post-rotation lines stay AFTER the pre-rotation
    // ones. Monotonic timestamps alone prove nothing here: the final sort makes them
    // monotonic either way — by reordering the recording, which is the bug.
    expect(r.sentences.map((s) => s.text)).toEqual([
      "Első szakasz.",
      "Még mindig az első.",
      "A rotáció utáni rész.",
      "És a vége.",
    ]);
    expect(r.sentences[2]!.startTs).toBeGreaterThan(r.sentences[1]!.startTs);
  });

  it("puts the break AFTER the last line of the old segment, not before it", () => {
    // An event's `ts` is the last speech before it, so it always ties with the sentence
    // it follows. Ranking events ahead of sentences printed every break one turn early.
    const r = stitchText(rotated, OPTS)!;
    const lines = r.markdown.split("\n\n");
    expect(lines.findIndex((l) => l.includes("Még mindig az első"))).toBeLessThan(
      lines.findIndex((l) => l.includes("capture rotation")),
    );
    expect(lines.findIndex((l) => l.includes("capture rotation"))).toBeLessThan(
      lines.findIndex((l) => l.includes("A rotáció utáni rész")),
    );
  });

  it("marks the break in both outputs", () => {
    const r = stitchText(rotated, OPTS)!;
    expect(r.stats.rotated).toBe(true);
    expect(r.markdown).toContain("capture rotation");
    expect(r.jsonl).toContain('"type":"rotation"');
  });
});

describe("edge cases", () => {
  it("is a no-op on an empty transcript", () => {
    expect(stitchText("", OPTS)).toBeNull();
    expect(stitchText("\n\n", OPTS)).toBeNull();
  });

  it("is a no-op on an event-only transcript", () => {
    expect(stitchText(jsonl([{ type: "silence", duration_ms: 3000, ts: 0 }]), OPTS)).toBeNull();
  });

  it("skips a truncated final line instead of aborting", () => {
    const text = jsonl([{ ts: 1000, speaker: "mic", text: "Megvan." }]) + '{"ts":2000,"spea';
    expect(stitchText(text, OPTS)!.sentences).toHaveLength(1);
  });

  it("silence events produce no text", () => {
    const r = stitchText(
      jsonl([
        { ts: 1000, speaker: "mic", text: "Egy." },
        { type: "silence", duration_ms: 5000, ts: 1000 },
        { ts: 9000, speaker: "mic", text: "Kettő." },
      ]),
      OPTS,
    )!;
    expect(r.sentences.map((s) => s.text)).toEqual(["Egy.", "Kettő."]);
    expect(r.markdown).not.toContain("silence");
  });

  it("renders a reconnect as a visible warning naming the unrecovered gap", () => {
    const r = stitchText(
      jsonl([
        { ts: 1000, speaker: "mic", text: "Mondom, hogy." },
        { type: "reconnect", ts: 1000, speaker: "system", downtime_ms: 12_000, replayed_audio_ms: 4000 },
        { ts: 20000, speaker: "mic", text: "Folytatom." },
      ]),
      OPTS,
    )!;
    expect(r.markdown).toContain("transcription dropped");
    expect(r.markdown).toContain("8.0s not recovered");
    expect(r.markdown).toContain("Words may be missing here");
    expect(r.jsonl).toContain('"type":"reconnect"');
    // The warning belongs between the two sentences, not ahead of the one it followed.
    const blocks = r.markdown.split("\n\n");
    expect(blocks.findIndex((b) => b.includes("Mondom, hogy"))).toBeLessThan(
      blocks.findIndex((b) => b.includes("transcription dropped")),
    );
    expect(blocks.findIndex((b) => b.includes("transcription dropped"))).toBeLessThan(
      blocks.findIndex((b) => b.includes("Folytatom")),
    );
  });

  it("emits a trailing fragment that never reached a sentence end", () => {
    const r = stitchText(jsonl([{ ts: 1000, speaker: "mic", text: "Félbeszakadt monda", partial: true }]), OPTS)!;
    expect(r.sentences[0]!.text).toBe("Félbeszakadt monda");
  });
});

describe("single-channel (dictation) input", () => {
  it("reassembles fragments and marks no overlap", () => {
    const r = stitchText(
      jsonl([
        { ts: 1000, startTs: 500, speaker: "mic", text: "Ez egy dikt", partial: true },
        { ts: 2000, startTs: 1500, speaker: "mic", text: "álás.", cont: true, midWord: true },
      ]),
      OPTS,
    )!;
    expect(r.sentences).toHaveLength(1);
    expect(r.sentences[0]!.text).toBe("Ez egy diktálás.");
    expect(r.sentences.some((s) => s.overlap)).toBe(false);
    expect(r.markdown).not.toContain("⇄");
  });
});

describe("redaction windows", () => {
  it("omits the sentences inside a window and states why, once", () => {
    const r = stitchText(
      jsonl([
        { ts: 1000, speaker: "mic", text: "Nyilvános." },
        { ts: 5000, speaker: "mic", text: "Bizalmas egy." },
        { ts: 6000, speaker: "mic", text: "Bizalmas kettő." },
        { ts: 9000, speaker: "mic", text: "Megint nyilvános." },
      ]),
      { ...OPTS, redactions: [{ from: 4000, to: 7000, reason: "ügyfél-adat" }] },
    )!;
    expect(r.markdown).not.toContain("Bizalmas");
    expect(r.markdown).toContain("ügyfél-adat");
    expect(r.markdown.match(/ügyfél-adat/g)).toHaveLength(1);
    expect(r.markdown).toContain("Nyilvános.");
    expect(r.jsonl).toContain('"type":"redacted"');
    expect(r.jsonl).not.toContain("Bizalmas");
  });
});

describe("the structured output", () => {
  it("carries one line per sentence with speaker, span, overlap and exactness", () => {
    const r = stitchText(jsonl(SIX_FRAGMENTS), OPTS)!;
    const rows = r.jsonl.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows).toHaveLength(r.sentences.length);
    const sys = rows.find((x) => x.speaker === "system")!;
    expect(sys.startTs).toBe(54000);
    expect(sys.endTs).toBe(66180);
    expect(sys.exact).toBe(true);
    expect(typeof sys.text).toBe("string");
  });

  it("agrees with the markdown on order", () => {
    const r = stitchText(jsonl(SIX_FRAGMENTS), OPTS)!;
    const texts = r.jsonl.trim().split("\n").map((l) => (JSON.parse(l) as { text: string }).text);
    let cursor = 0;
    for (const t of texts) {
      const at = r.markdown.indexOf(t, cursor);
      expect(at).toBeGreaterThanOrEqual(0);
      cursor = at;
    }
  });
});

describe("parseLines", () => {
  it("separates speech from timeline events and drops the rest", () => {
    const { lines, events } = parseLines(
      jsonl([
        { ts: 1, speaker: "mic", text: "Szia." },
        { type: "silence", duration_ms: 3000, ts: 1 },
        { type: "reconnect", ts: 2, speaker: "mic", downtime_ms: 1000 },
        { ts: 3, speaker: "mic" },
      ]),
    );
    expect(lines.map((l: StitchLine) => l.text)).toEqual(["Szia."]);
    expect(events.map((e) => e.type)).toEqual(["reconnect"]);
  });
});

describe("stitchTranscript", () => {
  it("returns null rather than empty artifacts", () => {
    expect(stitchTranscript({ lines: [], events: [] })).toBeNull();
  });
});
