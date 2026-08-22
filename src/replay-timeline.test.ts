/**
 * The timeline renderer.
 *
 * Two properties carry the operator requirement it exists for. A reviewer must be able
 * to read the whole run in order without opening the JSONL — so every entry appears,
 * timestamped, attributed, in scenario order. And a planted moment must appear WHERE IT
 * SPRINGS, not in a separate list a reader has to correlate by hand, because a trap
 * nobody notices during review is a trap that silently flatters the score.
 */

import { describe, expect, it } from "vitest";

import type { Scenario, ScriptEntry, PlantedMoment } from "./replay-scenario.js";
import { fingerprintOf, renderTimeline, timelineIsStale } from "./replay-timeline.js";

function line(ts: number, speaker: "mic" | "system", text: string, section?: string): ScriptEntry {
  return { section, line: { ts, speaker, text, final: true } as never };
}

const SCRIPT: ScriptEntry[] = [
  line(0, "mic", "Kezdjük.", "01 Bevezető"),
  line(5000, "system", "Melyik évre?", "01 Bevezető"),
  { event: { type: "silence", ts: 8000, duration_ms: 3000 } },
  line(12_000, "mic", "Három hét alatt megvagyunk.", "02 Vállalás"),
];

const MOMENTS: PlantedMoment[] = [
  { id: "m-year", at: 5000, kind: "question", expect: "notes the year is unanswered" },
  { id: "m-weeks", at: 12_000, kind: "contradiction", expect: "flags three weeks against six", withinMs: 30_000 },
];

function scenario(script = SCRIPT, moments = MOMENTS, fingerprint = "abc123"): Scenario {
  return {
    dir: "/tmp/x",
    meta: { name: "Referencia próba", description: "Teszt-forgatókönyv", sourceMaterial: "deck/_NEW" },
    script,
    moments,
    fingerprint,
    durationMs: 12_000,
  };
}

describe("renderTimeline", () => {
  it("renders entries as list items — bare lines collapse into one Markdown paragraph", () => {
    // The defect this guards: the whole timeline rendering as a single unreadable blob,
    // which defeats the one requirement the document exists for.
    for (const l of renderTimeline(scenario()).split("\n")) {
      if (/^`\d\d:\d\d`/.test(l)) expect.unreachable(`entry not a list item: ${l}`);
    }
  });

  it("renders every entry in order, timestamped and attributed", () => {
    const out = renderTimeline(scenario());
    expect(out).toContain("- `00:00` · **előadó**: Kezdjük.");
    expect(out).toContain("- `00:05` · **hallgatóság**: Melyik évre?");
    expect(out).toContain("- `00:12` · **előadó**: Három hét alatt megvagyunk.");
  });

  it("names a non-speech event rather than omitting it", () => {
    expect(renderTimeline(scenario())).toContain("- `00:08` · _— silence (3s) —_");
  });

  it("opens a section heading when the section changes, and not otherwise", () => {
    const out = renderTimeline(scenario());
    expect(out).toContain("## 01 Bevezető");
    expect(out).toContain("## 02 Vállalás");
    expect(out.match(/## 01 Bevezető/g)).toHaveLength(1);
  });

  it("places a planted moment where it springs, not in a separate list", () => {
    const lines = renderTimeline(scenario()).split("\n").filter((l) => l.trim());
    const question = lines.findIndex((l) => l.includes("Melyik évre?"));
    const planted = lines.findIndex((l) => l.includes("m-year"));
    const later = lines.findIndex((l) => l.includes("Három hét"));
    expect(planted).toBeGreaterThan(question);
    expect(planted).toBeLessThan(later);
  });

  it("states what each planted moment expects, so a reviewer can judge the trap", () => {
    const out = renderTimeline(scenario());
    expect(out).toContain("flags three weeks against six");
    expect(out).toContain("⟨planted: contradiction⟩");
    expect(out).toContain("within 30s");
  });

  it("still shows a moment planted after the last entry rather than dropping it", () => {
    const out = renderTimeline(scenario(SCRIPT, [
      ...MOMENTS,
      { id: "m-end", at: 99_000, kind: "decision", expect: "records the closing decision" },
    ]));
    expect(out).toContain("m-end");
  });

  it("carries the header facts a reviewer needs before reading", () => {
    const out = renderTimeline(scenario());
    expect(out).toContain("**Hossz:** 00:12");
    expect(out).toContain("**Bejegyzések:** 4");
    expect(out).toContain("**Beültetett pillanatok:** 2");
    expect(out).toContain("deck/_NEW");
  });
});

describe("timelineIsStale", () => {
  it("treats a missing timeline as stale", () => {
    expect(timelineIsStale(scenario(), null)).toBe(true);
  });

  it("is current for a timeline rendered from the same scenario", () => {
    const s = scenario();
    expect(timelineIsStale(s, renderTimeline(s))).toBe(false);
  });

  it("goes stale when the script changes under it", () => {
    const before = renderTimeline(scenario());
    const after = scenario([...SCRIPT, line(16_000, "mic", "Még valami.")], MOMENTS, "different");
    expect(timelineIsStale(after, before)).toBe(true);
  });

  it("treats a timeline with no fingerprint as stale rather than trusting it", () => {
    expect(timelineIsStale(scenario(), "# Egy kézzel írt idővonal\n")).toBe(true);
  });

  it("reads back the fingerprint it recorded", () => {
    expect(fingerprintOf(renderTimeline(scenario()))).toBe("abc123");
  });
});
