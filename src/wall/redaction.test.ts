import { describe, expect, it, vi } from "vitest";

import { compileRedactor, isCatastrophic, splitForZones, unboundedQuantifierCount } from "./redaction.js";
import type { DisplayEvent, RedactionConfig } from "./types.js";

// A deliberately simple taxonomy for the tests: a token shape (Unicode classes,
// never \b) plus the shipped `[belső]` marking convention.
const CFG: RedactionConfig = {
  patterns: ["SECRET-[\\p{L}\\p{N}]+", "\\[(?:belső|internal)[^\\]]*\\][^\\n]*"],
  replacement: "[…]",
  maxInputLength: 10_000,
};

function redactor(cfg: Partial<RedactionConfig> = {}, warn = () => {}) {
  return compileRedactor({ ...CFG, ...cfg }, warn);
}

/** The JSON a public client would actually receive (or null if withheld). */
function publicJSON(ev: DisplayEvent, cfg?: Partial<RedactionConfig>): string | null {
  const out = splitForZones(ev, redactor(cfg)).public;
  return out ? JSON.stringify(out) : null;
}

describe("recursive redaction walks the whole payload (D1)", () => {
  it("redacts a free-form payload key the field list never enumerated (nodes[].secretNote)", () => {
    const ev: DisplayEvent = {
      category: "architektúra", zone: "both", visual: "v1",
      graph: { op: "reset", nodes: [{ id: "a", label: "A", secretNote: "SECRET-hush" }] },
    };
    const json = publicJSON(ev);
    expect(json).not.toContain("SECRET-hush");
    expect(json).toContain("[…]");
  });

  it("redacts structural identifiers: node.id, chart.unit, chart.data[].note", () => {
    const graph: DisplayEvent = {
      category: "architektúra", zone: "both", visual: "v1",
      graph: { op: "reset", nodes: [{ id: "SECRET-node1", label: "ok" }] },
    };
    expect(publicJSON(graph)).not.toContain("SECRET-node1");

    const chart: DisplayEvent = {
      category: "metrika", zone: "both",
      chart: { type: "bar", unit: "SECRET-pct", data: [{ label: "x", value: 1, note: "SECRET-leak" } as never] },
    };
    const cj = publicJSON(chart);
    expect(cj).not.toContain("SECRET-pct");
    expect(cj).not.toContain("SECRET-leak");
  });

  it("is not defeated by nesting depth", () => {
    const ev: DisplayEvent = {
      category: "architektúra", zone: "both", visual: "v1",
      graph: { op: "reset", nodes: [{ id: "a", meta: { deep: { deeper: ["ok", "SECRET-buried"] } } } as never] },
    };
    expect(publicJSON(ev)).not.toContain("SECRET-buried");
  });

  it("does not touch non-string leaves (numbers, booleans)", () => {
    const ev: DisplayEvent = {
      category: "metrika", zone: "both",
      chart: { type: "bar", data: [{ label: "x", value: 42 }] },
    };
    const out = splitForZones(ev, redactor()).public!;
    expect(out.chart!.data[0].value).toBe(42);
  });
});

describe("URL sources withhold the whole event, never scrub (D2)", () => {
  it("withholds when the same token hides in a webpage.url query, private gets it unchanged", () => {
    const ev: DisplayEvent = {
      category: "doc", zone: "both",
      webpage: { url: "https://x.test/report?token=SECRET-abc", title: "SECRET-abc summary" },
    };
    const { public: pub, private: priv, redacted } = splitForZones(ev, redactor());
    expect(pub).toBeNull(); // withheld entirely — no scrubbed-title-plus-leaking-URL
    expect(redacted).toBe(true);
    // Private receives the content unchanged, plus the observability marker.
    expect(priv.webpage!.url).toBe("https://x.test/report?token=SECRET-abc");
    expect(priv.webpage!.title).toBe("SECRET-abc summary");
    expect(priv.redaction).toBe("withheld");
  });

  it("passes a clean image src to the public zone", () => {
    const ev: DisplayEvent = { category: "kép", zone: "both", image: { src: "diagram.png", caption: "clean" } };
    const out = splitForZones(ev, redactor()).public;
    expect(out).not.toBeNull();
    expect(out!.image!.src).toBe("diagram.png");
  });
});

describe("fail-closed (D5)", () => {
  it("withholds from public when a leaf is too long to bound safely", () => {
    const ev: DisplayEvent = { category: "narráció", zone: "both", text: "x".repeat(50) };
    const { public: pub, private: priv, redacted } = splitForZones(ev, redactor({ maxInputLength: 10 }));
    expect(pub).toBeNull();
    expect(redacted).toBe(true);
    expect(priv.redaction).toBe("withheld"); // private may still receive it, marked
  });

  it("an invalid config pattern is dropped with a warning, the rest still redact", () => {
    const warn = vi.fn();
    const r = redactor({ patterns: ["(", "SECRET-[\\p{L}\\p{N}]+"] }, warn);
    expect(warn).toHaveBeenCalled();
    expect(r.patternCount).toBe(1); // the valid one survived
    expect(r.scrub("SECRET-x here")).toContain("[…]");
  });
});

describe("ReDoS bound (D6)", () => {
  it("rejects EVERY repeated group — the whole ReDoS class, not a guessed subset", () => {
    // Repeated groups are the structural requirement for exponential backtracking, so
    // all of these are rejected regardless of body — including the two shapes that
    // walked around earlier heuristics: alternation-overlap and a NESTED group.
    expect(isCatastrophic("(a+)+$")).toBe(true);
    expect(isCatastrophic("(a*)*")).toBe(true);
    expect(isCatastrophic("(a{2,})+")).toBe(true);
    expect(isCatastrophic("(a|a)+$")).toBe(true);      // alternation-overlap (~11s)
    expect(isCatastrophic("(a|ab)+$")).toBe(true);
    expect(isCatastrophic("(([a-z])+)+$")).toBe(true); // nested group (~78s) — the last bypass
    expect(isCatastrophic("(ab)+")).toBe(true);        // conservative: a fixed-body repeat is rejected too
    expect(isCatastrophic("(cat|dog)*")).toBe(true);
  });

  it("allows non-repeated groups and group-free patterns (no false rejections that matter)", () => {
    expect(isCatastrophic("SECRET-[\\p{L}\\p{N}]+")).toBe(false); // quantified CLASS, not group
    expect(isCatastrophic("\\[(?:belső|internal)[^\\]]*\\][^\\n]*")).toBe(false); // shipped default
    expect(isCatastrophic("(?:foo|bar)")).toBe(false);   // non-repeated group
    expect(isCatastrophic("(https?)://")).toBe(false);   // ? is inside the group, not after it
    expect(isCatastrophic("(internal|belső)[^\\]]*")).toBe(false);
    expect(isCatastrophic("(a)?b")).toBe(false);         // optional group is bounded/safe
    expect(isCatastrophic("\\)+")).toBe(false);          // an ESCAPED paren is not a group close
    expect(isCatastrophic("[)]+")).toBe(false);          // a ) inside a class is not a group close
  });

  it("keeps evaluation bounded by dropping any repeated group at load", () => {
    const warn = vi.fn();
    // A nested repeated group — the shape that measured 78s — must never load.
    const r = compileRedactor({ patterns: ["(([a-z])+)+$"], replacement: "[…]", maxInputLength: 10_000 }, warn);
    expect(warn).toHaveBeenCalled();
    expect(r.patternCount).toBe(0);
    const start = Date.now();
    r.scrub("a".repeat(40) + "!"); // would stall for a minute+ if it had loaded
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("bounds the POLYNOMIAL class: drops a pattern with too many unbounded quantifiers", () => {
    // Sequential overlapping quantifiers (no repeated group) — the class that walked
    // past the group rule. `\d+`×14 measured 33s at 37 chars; k>2 is rejected at load.
    const warn = vi.fn();
    const src = "\\d+".repeat(14) + "$";
    const r = compileRedactor({ patterns: [src], replacement: "[…]", maxInputLength: 10_000 }, warn);
    expect(warn).toHaveBeenCalled();
    expect(r.patternCount).toBe(0);
    const start = Date.now();
    r.scrub("1".repeat(37) + "!"); // would stall for tens of seconds if it had loaded
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("allows up to two unbounded quantifiers, kept bounded by the length cap", () => {
    // Two OVERLAPPING quantifiers with a failing anchor backtrack quadratically; the
    // 1000-char cap bounds that to a fraction of a second — bounded, not the multi-second
    // stall an unbounded-degree pattern (`\d+`×14) produces. This is the residual the
    // fix deliberately accepts for a config-only footgun (see DEFAULT_REDACTION note).
    const r = compileRedactor({ patterns: ["\\d+\\d+$"], replacement: "[…]", maxInputLength: 1_000 }, () => {});
    expect(r.patternCount).toBe(1);
    const start = Date.now();
    r.scrub("1".repeat(999) + "!"); // worst-case quadratic input, bounded by the cap
    expect(Date.now() - start).toBeLessThan(800); // not a DoS (unbounded would be tens of seconds)
    // The shipped default carries exactly two unbounded quantifiers — but NON-overlapping
    // (separated by `\]`), so it is linear — and still loads.
    expect(unboundedQuantifierCount("\\[(?:belső|internal)[^\\]]*\\][^\\n]*")).toBe(2);
  });

  it("drops a catastrophic pattern at compile so it never evaluates", () => {
    const warn = vi.fn();
    const r = compileRedactor({ patterns: ["(a+)+$"], replacement: "[…]", maxInputLength: 10_000 }, warn);
    expect(warn).toHaveBeenCalled();
    expect(r.patternCount).toBe(0);
    // The crafted input that would have stalled the wall is now a cheap no-op.
    expect(r.scrub("a".repeat(40))).toBe("a".repeat(40));
  });
});

describe("zone handling & observability (D7)", () => {
  it("leaves a private-only event untouched with no public variant", () => {
    const ev: DisplayEvent = { category: "súgás", zone: "private", text: "SECRET-x stays private" };
    const { public: pub, private: priv, redacted } = splitForZones(ev, redactor());
    expect(pub).toBeNull();
    expect(redacted).toBe(false);
    expect(priv).toBe(ev); // untouched, not even cloned
  });

  it("marks the private copy when the public copy was scrubbed", () => {
    const ev: DisplayEvent = { category: "narráció", zone: "both", text: "before SECRET-y after" };
    const { public: pub, private: priv } = splitForZones(ev, redactor());
    expect(pub!.text).toBe("before […] after");
    expect(pub!.redaction).toBeUndefined(); // never on the public copy
    expect(priv.redaction).toBe("redacted");
    expect(priv.text).toBe("before SECRET-y after"); // private content unchanged
  });

  it("passes an unmatched public event through unchanged", () => {
    const ev: DisplayEvent = { category: "narráció", zone: "both", text: "nothing sensitive" };
    const { public: pub, redacted } = splitForZones(ev, redactor());
    expect(pub).toBe(ev);
    expect(redacted).toBe(false);
  });
});

describe("taxonomy is config, not code (D8 / 1.5)", () => {
  it("the shipped [belső] marking convention scrubs to end-of-leaf", () => {
    const ev: DisplayEvent = { category: "narráció", zone: "both", text: "public part [belső] hush hush" };
    expect(splitForZones(ev, redactor()).public!.text).toBe("public part […]");
  });

  it("a project's own terms redact via config alone, no engine edit", () => {
    const ev: DisplayEvent = { category: "narráció", zone: "both", text: "Project Hush ships Friday" };
    const r = redactor({ patterns: ["Project\\s+Hush"] });
    expect(splitForZones(ev, r).public!.text).toBe("[…] ships Friday");
  });

  it("a replacement with $& does not re-inject the matched secret", () => {
    // A config author writing "[redacted:$&]" to 'show what was hidden' would, without
    // escaping, re-publish the secret verbatim via String.replace's special patterns.
    const r = redactor({ patterns: ["SECRET-[\\p{L}\\p{N}]+"], replacement: "[redacted:$&]" });
    const out = r.scrub("code SECRET-hush42 here");
    expect(out).toBe("code [redacted:$&] here");
    expect(out).not.toContain("SECRET-hush42");
  });
});
