/**
 * Deck extraction.
 *
 * The failure this guards against is silence: a deck that extracts to nothing (or to a
 * loader shell's "this page requires JavaScript") produces a copilot that says nothing,
 * and nobody can tell that apart from a meeting where nothing was worth saying. So every
 * empty result here is a reported problem, never an empty success.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_FACTS_PER_SLIDE, extractDeck, extractFacts, extractFile, fileOrder, htmlTitle,
  htmlToText, parseFigure, unwrapBundlerTemplate,
} from "./deck.js";

const quiet = (): void => {};
const files = (map: Record<string, string>) => (p: string): string => {
  if (!(p in map)) throw new Error("ENOENT");
  return map[p];
};

describe("htmlToText", () => {
  it("keeps visible text and drops markup", () => {
    expect(htmlToText("<div><h1>Cím</h1><p>Szöveg itt.</p></div>")).toBe("Cím\nSzöveg itt.");
  });

  it("drops scripts and styles rather than reading them as content", () => {
    const out = htmlToText("<style>.a{color:red}</style><script>var x=1</script><p>Marad</p>");
    expect(out).toBe("Marad");
  });

  it("drops embedded data URIs, which are the bulk of an exported slide", () => {
    const out = htmlToText(`<img src="data:image/png;base64,${"A".repeat(5000)}"><p>Marad</p>`);
    expect(out).toBe("Marad");
    expect(out.length).toBeLessThan(50);
  });

  it("drops the document title — it is head metadata, not visible slide text", () => {
    // Left in, every slide's first extracted fact became its own slide number, because an
    // exported slide is titled `11 — ASP …`.
    expect(htmlToText("<head><title>11 — ASP</title></head><body><p>21,8 milliárd</p></body>"))
      .toBe("21,8 milliárd");
  });

  it("decodes the entities a deck actually contains", () => {
    expect(htmlToText("<p>KPI-mérés &amp; Dashboard</p>")).toBe("KPI-mérés & Dashboard");
  });
});

describe("unwrapBundlerTemplate", () => {
  const real = "<html><body><h1>Nyílt forráskód × AI</h1><p>Az opensource itthon megvolt és működött, "
    + "8613 telepítés, majd 2022-ben leállították. Most az AI teszi stratégiai tétté: a nyílt forráskód "
    + "adja a transzparens motort, az ágensek a hatékonysági turbót.</p></body></html>";
  const wrapped = `<html><body><div>This page requires JavaScript to display.</div>
    <script type="__bundler/template">${JSON.stringify(real)}</script></body></html>`;

  it("unwraps a static-export shell to the real document", () => {
    expect(unwrapBundlerTemplate(wrapped)).toBe(real);
  });

  it("yields the deck's content rather than the shell's loading text", () => {
    const text = htmlToText(wrapped);
    expect(text).toContain("8613 telepítés");
    expect(text).not.toContain("requires JavaScript");
  });

  it("leaves an ordinary document alone", () => {
    expect(unwrapBundlerTemplate(real)).toBe(real);
  });

  it("does not unwrap a fragment too small to be a document — that guard is why the ratio test was wrong", () => {
    const tiny = `<html><body><p>valódi</p><script type="__bundler/template">${JSON.stringify("<p>x</p>")}</script></body></html>`;
    expect(unwrapBundlerTemplate(tiny)).toBe(tiny);
  });

  it("unwraps a small document out of a huge file — the file is big because of embedded images", () => {
    // The first version compared the template against the FILE size and failed on exactly
    // the slides that needed it: 11 KB of document inside 5.5 MB of base64 images.
    const padding = `<img src="data:image/png;base64,${"A".repeat(300000)}">`;
    const huge = `<html><body>${padding}<div>Unpacking…</div><script type="__bundler/template">${JSON.stringify(real)}</script></body></html>`;
    expect(unwrapBundlerTemplate(huge)).toBe(real);
  });

  it("leaves a document alone when the template is not a JSON string", () => {
    const odd = '<script type="__bundler/template">{"not":"a string"}</script><p>x</p>';
    expect(unwrapBundlerTemplate(odd)).toBe(odd);
  });
});

describe("htmlTitle", () => {
  it("prefers the document title", () => {
    expect(htmlTitle("<title>11 — ASP három állapot</title><h1>Más</h1>")).toBe("11 — ASP három állapot");
  });

  it("falls back to the first heading", () => {
    expect(htmlTitle("<h2>Referencia-architektúra</h2>")).toBe("Referencia-architektúra");
  });

  it("reads the title through a bundler wrapper", () => {
    const wrapped = `<script type="__bundler/template">${JSON.stringify("<title>Igazi cím</title>")}</script>`;
    expect(htmlTitle(wrapped)).toBe("Igazi cím");
  });

  it("returns null when there is nothing to take", () => {
    expect(htmlTitle("<p>csak szöveg</p>")).toBeNull();
  });
});

describe("parseFigure", () => {
  it("reads both decimal conventions as the same figure — a deck and a speaker may not share one", () => {
    expect(parseFigure("21,8")).toBe(21.8);
    expect(parseFigure("21.8")).toBe(21.8);
  });

  it("reads a thousands-grouped figure", () => {
    expect(parseFigure("1 500")).toBe(1500);
    expect(parseFigure("8613")).toBe(8613);
  });
});

describe("extractFacts", () => {
  it("captures a figure with its scale word", () => {
    const f = extractFacts("21,8 milliárd forint épült be egy működő szolgáltatásba", 11, "ASP");
    expect(f[0]).toMatchObject({ figure: "21,8", value: 21.8, unit: "milliárd" });
  });

  it("keeps enough surrounding words to say what the figure refers to", () => {
    const f = extractFacts("Az ENSZ rangsorában az 59. helyen állunk", 3, "Diagnózis");
    expect(f[0].context).toContain("ENSZ");
    expect(f[0].context).toContain("⟨59⟩");
  });

  it("names the slide every fact came from, because the citation is the point", () => {
    const f = extractFacts("300 óra adminisztráció", 4, "reform-program");
    expect(f[0]).toMatchObject({ slideIndex: 4, slideTitle: "reform-program" });
  });

  it("yields nothing for a slide with no numbers, which is not an error", () => {
    expect(extractFacts("Nem lerombolunk, ráépítünk.", 5, "GaaP")).toEqual([]);
  });

  it("ranks before capping, so a slide's real claim survives a crowd of ticks", () => {
    // The harm of the cap is not that a spurious fact survives — it is that the claim gets
    // pushed out by ticks that happened to appear first.
    const noisy = "1 db · 2 db · 3 db · 4 db · 5 db · 6 db · 7 db · 8 db · 9 db · 10 db · 11 db · 12 db · "
      + "13 db · 14 db · a beruházás 21,8 milliárd forint volt";
    const f = extractFacts(noisy, 11, "ASP");
    expect(f.some((x) => x.figure === "21,8")).toBe(true);
  });

  it("caps a number-dense slide so it cannot flood the digest", () => {
    const dense = Array.from({ length: 40 }, (_, i) => `${i + 1} egység`).join(" ");
    expect(extractFacts(dense, 1, "sűrű").length).toBe(MAX_FACTS_PER_SLIDE);
  });

  it("returns facts in reading order, whatever the ranking chose", () => {
    const f = extractFacts("előbb 5 óra munka, aztán 9 óra pihenés", 1, "x");
    expect(f.map((x) => x.figure)).toEqual(["5", "9"]);
  });

  it("skips a chart axis — those are numbers a slide DISPLAYS, not claims it MAKES", () => {
    // Without this, one axis fills a slide's entire fact budget and pushes out the figure
    // the slide is actually about.
    expect(extractFacts("· 0 · 2 · 4 · 6 · 8 · 10 ·", 1, "EDGI")).toEqual([]);
  });

  it("keeps a figure that sits among words, even with no unit", () => {
    const f = extractFacts("Az ENSZ rangsorában az 59. helyen állunk", 3, "Diagnózis");
    expect(f).toHaveLength(1);
    expect(f[0].figure).toBe("59");
  });

  it("over-collects rather than missing — a spurious fact is cheaper than a missed alert", () => {
    // A page number becomes a fact. Deliberate: the alternative direction loses the
    // contradiction this whole capability exists to catch.
    expect(extractFacts("v0.3.0 · 1 / 17", 1, "TOC").length).toBeGreaterThan(0);
  });
});

describe("extractFile", () => {
  it("splits a markdown deck on its headings and titles each slide", () => {
    const md = "# Első\nszöveg egy\n## Második\nszöveg kettő";
    const { slides } = extractFile("/d/deck.md", files({ "/d/deck.md": md }));
    expect(slides.map((s) => s.title)).toEqual(["Első", "Második"]);
    expect(slides[1].text).toBe("szöveg kettő");
  });

  it("titles a heading-less file from its name rather than leaving it uncitable", () => {
    const { slides } = extractFile("/d/04-reform-program.md", files({ "/d/04-reform-program.md": "csak szöveg" }));
    expect(slides[0].title).toBe("reform program");
  });

  it("treats one HTML file as one slide — an exported deck ships a file per slide", () => {
    const html = "<title>05 GaaP</title><h1>A</h1><p>a</p><h2>B</h2><p>b</p>";
    const { slides } = extractFile("/d/05.html", files({ "/d/05.html": html }));
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe("05 GaaP");
  });

  it("reports an unreadable file instead of throwing", () => {
    const { slides, problem } = extractFile("/d/missing.md", files({}));
    expect(slides).toEqual([]);
    expect(problem).toMatch(/cannot read/);
  });

  it("reports an HTML file with no visible text", () => {
    const { problem } = extractFile("/d/x.html", files({ "/d/x.html": "<script>var a=1</script>" }));
    expect(problem).toMatch(/no visible text/);
  });

  it("reports an empty file", () => {
    expect(extractFile("/d/e.md", files({ "/d/e.md": "   " })).problem).toMatch(/empty/);
  });
});

describe("fileOrder", () => {
  it("reads the leading number a deck's filenames carry", () => {
    expect(fileOrder("/d/03-diagnozis.html")).toBe(3);
    expect(fileOrder("/d/14-qvik.html")).toBe(14);
  });

  it("sorts an unnumbered file after the numbered ones rather than guessing", () => {
    expect(fileOrder("/d/appendix.html")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("extractDeck", () => {
  const deck = {
    "/d/02-kutatas.html": "<title>02 Kutatás</title><p>11 vizsgálati szint</p>",
    "/d/01-edgi.html": "<title>01 EDGI</title><p>Öt ország</p>",
    "/d/11-asp.html": "<title>11 ASP</title><p>21,8 milliárd forint</p>",
  };

  it("orders slides by the deck's own numbering, not by configured order", () => {
    const { slides } = extractDeck(Object.keys(deck), files(deck), quiet);
    expect(slides.map((s) => s.title)).toEqual(["01 EDGI", "02 Kutatás", "11 ASP"]);
  });

  it("numbers slides consecutively from one, so a citation is stable", () => {
    const { slides } = extractDeck(Object.keys(deck), files(deck), quiet);
    expect(slides.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it("attaches each slide's facts to it", () => {
    const { slides } = extractDeck(Object.keys(deck), files(deck), quiet);
    const asp = slides.find((s) => s.title === "11 ASP");
    expect(asp?.facts[0]).toMatchObject({ value: 21.8, unit: "milliárd", slideTitle: "11 ASP" });
  });

  it("skips a broken file, reports it, and still extracts the rest", () => {
    const { slides, problems } = extractDeck([...Object.keys(deck), "/d/gone.html"], files(deck), quiet);
    expect(slides).toHaveLength(3);
    expect(problems).toEqual([{ file: "/d/gone.html", reason: expect.stringMatching(/cannot read/) as unknown as string }]);
  });

  it("warns when a configured deck extracts to nothing — silence is the worst failure here", () => {
    const warnings: string[] = [];
    extractDeck(["/d/gone.html"], files({}), (m) => warnings.push(m));
    expect(warnings.join(" ")).toMatch(/nothing extracted/);
  });

  it("says nothing and does nothing when no deck is configured", () => {
    const warnings: string[] = [];
    const out = extractDeck([], files({}), (m) => warnings.push(m));
    expect(out).toEqual({ slides: [], problems: [] });
    expect(warnings).toEqual([]);
  });
});
