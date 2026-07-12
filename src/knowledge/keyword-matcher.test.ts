import { describe, expect, it } from "vitest";

import { buildMatcher, stemFromName, topicFromName } from "./keyword-matcher.js";

describe("buildMatcher", () => {
  const match = buildMatcher([
    { topic: "invoice", stems: ["invoic", "számlá?"] },
    { topic: "Acme", stems: [stemFromName("Acme Kft.")!] },
  ]);

  it("matches a stem inside an inflected form", () => {
    expect(match("we are invoicing them tomorrow")).toEqual(["invoice"]);
    expect(match("a számlázás jövő héten indul")).toEqual(["invoice"]);
  });

  it("anchors at a word start, so a stem does not match mid-word", () => {
    expect(match("the proinvoice hack")).toEqual([]);
  });

  it("treats accented letters as word characters, not boundaries", () => {
    // "őszámla" is one word: the stem must NOT fire on it just because "ő" is
    // outside \w. This is the bug the old [0-9a-z…] class hid for non-Hungarian text.
    expect(match("őszámla")).toEqual([]);
  });

  it("works for scripts the package never enumerated", () => {
    const cyrillic = buildMatcher([{ topic: "счёт", stems: ["счёт"] }]);
    expect(cyrillic("выставили счёт вчера")).toEqual(["счёт"]);
    expect(cyrillic("подсчёт")).toEqual([]);
  });

  it("dedupes and preserves index order", () => {
    expect(match("invoice for Acme, second invoice for Acme")).toEqual(["invoice", "Acme"]);
  });

  it("recognises decision references and normalises them", () => {
    const m = buildMatcher([], { decisionIdPrefix: "DEC" });
    expect(m("as we said in DEC-3 and dec 12")).toEqual(["DEC-003", "DEC-012"]);
  });

  it("does not treat a bare prefix as a decision reference", () => {
    const m = buildMatcher([], { decisionIdPrefix: "DEC" });
    expect(m("the decision was made")).toEqual([]);
  });
});

describe("stemFromName", () => {
  it("strips the company form and tolerates the separator", () => {
    const stem = stemFromName("Acme Kft.")!;
    expect(new RegExp(stem, "iu").test("acme-nak")).toBe(true);
    expect(topicFromName("Acme Kft.")).toBe("Acme");
  });

  it("requires a word end for short names, to avoid substring hits", () => {
    const match = buildMatcher([{ topic: "IBM", stems: [stemFromName("IBM")!] }]);
    expect(match("call IBM today")).toEqual(["IBM"]);
    expect(match("ibms")).toEqual([]);
  });

  it("returns null for a name too short to be a safe stem", () => {
    expect(stemFromName("X")).toBeNull();
  });
});
