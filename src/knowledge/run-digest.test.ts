/**
 * The deck's contribution to the knowledge pipeline.
 *
 * Contributed by the pipeline rather than by an adapter, so a project running a custom
 * adapter gets deck awareness without implementing it — and so a project with no deck is
 * provably unchanged, which is a spec scenario rather than an assumption.
 */

import { describe, expect, it } from "vitest";

import type { Slide } from "./deck.js";
import { renderDeckDigest, slideContext, slideKeywordPatterns } from "./run-digest.js";

const slide = (index: number, title: string, text: string, facts: Slide["facts"] = []): Slide =>
  ({ index, title, text, source: `/d/${index}.html`, facts });

const ASP = slide(11, "ASP három állapot", "21,8 milliárd forint épült be egy működő szolgáltatásba.", [
  { figure: "21,8", value: 21.8, unit: "milliárd", context: "⟨21,8⟩ milliárd forint épült be", slideIndex: 11, slideTitle: "ASP három állapot" },
]);

describe("slideKeywordPatterns", () => {
  it("makes each slide a topic a transcript line can be tagged with", () => {
    const [p] = slideKeywordPatterns([ASP]);
    expect(p.topic).toBe("dia 11: ASP három állapot");
    expect(p.stems).toContain("állapot");
  });

  it("drops short lowercase words — matching on those would tag every line with every slide", () => {
    const [p] = slideKeywordPatterns([slide(1, "A mi új terv", "x")]);
    expect(p).toBeUndefined();
  });

  it("keeps a short ACRONYM — those are exactly what a presenter says out loud", () => {
    // A flat five-character floor drops ASP, KPI, GaaP, DÁP — the domain terms that
    // actually get spoken when a presenter arrives at a slide.
    const [p] = slideKeywordPatterns([slide(1, "Az ASP és a GaaP réteg", "x")]);
    expect(p.stems).toContain("asp");
    expect(p.stems).toContain("gaap");
  });

  it("drops a stem shared by many slides — that tags every line with every slide", () => {
    // Measured on a real deck: build-id titles put `quick`, `profile` and `deck` on half
    // the slides, and one spoken sentence then matched six of them at once.
    const deck = [
      slide(1, "quick win alkalmazott profile", "x"),
      slide(2, "quick win ASP profile", "x"),
      slide(3, "quick win mérés profile", "x"),
      slide(4, "nyílt forráskód", "x"),
    ];
    const p = slideKeywordPatterns(deck);
    expect(p.find((x) => x.topic.startsWith("dia 2"))?.stems).toEqual(["asp"]);
    expect(p.find((x) => x.topic.startsWith("dia 4"))?.stems).toEqual(["nyílt", "forráskód"]);
  });

  it("drops a slide entirely when every one of its words is too common", () => {
    const deck = [slide(1, "közös közös", "x"), slide(2, "közös közös", "x"), slide(3, "egyedi téma", "x")];
    expect(slideKeywordPatterns(deck).map((p) => p.topic)).toEqual(["dia 3: egyedi téma"]);
  });

  it("deduplicates stems", () => {
    const [p] = slideKeywordPatterns([slide(2, "Mérés és mérés", "x")]);
    expect(p.stems).toEqual(["mérés"]);
  });
});

describe("slideContext", () => {
  it("carries enough to cite without carrying the whole deck", () => {
    const [c] = slideContext([ASP]);
    expect(c).toMatchObject({ index: 11, title: "ASP három állapot" });
    expect(c.facts[0]).toMatchObject({ figure: "21,8", unit: "milliárd" });
  });

  it("trims a long slide rather than pasting it into every session", () => {
    const [c] = slideContext([slide(1, "Hosszú", "x".repeat(5000))]);
    expect(c.summary.length).toBe(400);
  });
});

describe("renderDeckDigest", () => {
  it("leads with the facts, because the contradiction to catch is a figure", () => {
    const out = renderDeckDigest([ASP]);
    const factLine = out.indexOf("**21,8 milliárd**");
    const prose = out.indexOf("épült be egy működő");
    expect(factLine).toBeGreaterThan(-1);
    expect(factLine).toBeLessThan(prose);
  });

  it("tells the reader to cite the slide, not the knowledge base", () => {
    expect(renderDeckDigest([ASP])).toMatch(/hivatkozd a diát/);
  });

  it("numbers each slide so a citation is unambiguous", () => {
    expect(renderDeckDigest([ASP])).toContain("### 11. dia — ASP három állapot");
  });

  it("renders nothing at all with no deck — a project without one is unchanged", () => {
    expect(renderDeckDigest([])).toBe("");
  });

  it("still renders a slide that asserts no numbers", () => {
    expect(renderDeckDigest([slide(5, "GaaP", "Nem lerombolunk, ráépítünk.")])).toContain("GaaP");
  });
});
