import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MarkdownAdapter, isTopicLike } from "./markdown-adapter.js";
import { DEFAULT_DEFERRED_MARKERS } from "../config.js";
import type { AdapterContext } from "./types.js";

let root: string;

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  projectRoot: root,
  sources: ["docs"],
  seedKeywords: [],
  autoKeywords: true,
  deferredMarkers: DEFAULT_DEFERRED_MARKERS,
  ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sc-md-"));
  mkdirSync(join(root, "docs", "decisions"), { recursive: true });
  writeFileSync(
    join(root, "docs", "logistics.md"),
    [
      "---",
      "tags: freight, last-mile",
      "---",
      "# Logistics",
      "",
      "## Delivery notes",
      "Driver app uploads photos.",
      "",
      "## Overview",
      "- Cutting log: deferred: phase-2 (REQ-LOG-12)",
      "",
      "## A heading that is really a whole prose sentence about things",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "docs", "decisions", "DEC-001.md"),
    ["---", "id: DEC-001", "title: Use PostgreSQL", "status: active", "---", "", "We picked Postgres over MySQL."].join("\n"),
  );
  writeFileSync(
    join(root, "docs", "decisions", "DEC-002.md"),
    ["---", "id: DEC-002", "title: Old choice", "status: superseded", "---", "", "Replaced by DEC-001."].join("\n"),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("keywordPatterns", () => {
  it("derives topics from titles, headings and frontmatter tags", () => {
    const topics = new MarkdownAdapter(ctx()).keywordPatterns().map((p) => p.topic);
    expect(topics).toContain("Logistics");
    expect(topics).toContain("Delivery notes");
    expect(topics).toContain("freight");
    expect(topics).toContain("last-mile");
  });

  it("skips document furniture and prose headings", () => {
    const topics = new MarkdownAdapter(ctx()).keywordPatterns().map((p) => p.topic);
    expect(topics).not.toContain("Overview");
    expect(topics.some((t) => t.startsWith("A heading that is really"))).toBe(false);
  });

  it("keeps hand-written seeds first and does not duplicate them", () => {
    const seeds = [{ topic: "Logistics", stems: ["logisztik", "logistic"] }];
    const patterns = new MarkdownAdapter(ctx({ seedKeywords: seeds })).keywordPatterns();
    expect(patterns[0]).toEqual(seeds[0]);
    expect(patterns.filter((p) => p.topic === "Logistics").length).toBe(1);
  });

  it("returns only the seeds when autoKeywords is off", () => {
    const seeds = [{ topic: "invoice", stems: ["invoic"] }];
    const patterns = new MarkdownAdapter(ctx({ autoKeywords: false, seedKeywords: seeds })).keywordPatterns();
    expect(patterns).toEqual(seeds);
  });
});

describe("enrichedContext", () => {
  it("reads active decisions and skips superseded ones", () => {
    const { decisions } = new MarkdownAdapter(ctx({ decisionsDir: "docs/decisions" })).enrichedContext();
    expect(decisions.map((d) => d.id)).toEqual(["DEC-001"]);
    expect(decisions[0]!.title).toBe("Use PostgreSQL");
    expect(decisions[0]!.summary).toBe("We picked Postgres over MySQL.");
  });

  it("greps deferred items with the configured markers and picks up the ticket id", () => {
    const { deferred } = new MarkdownAdapter(ctx()).enrichedContext();
    expect(deferred.length).toBe(1);
    expect(deferred[0]!.req).toBe("REQ-LOG-12");
    expect(deferred[0]!.source).toBe(join("docs", "logistics.md"));
  });

  it("finds nothing deferred when the project's markers do not appear", () => {
    const { deferred } = new MarkdownAdapter(ctx({ deferredMarkers: ["\\bhalasztva\\b"] })).enrichedContext();
    expect(deferred).toEqual([]);
  });
});

describe("digestMarkdown", () => {
  it("says so when no sources resolve, instead of emitting an empty document", () => {
    const digest = new MarkdownAdapter(ctx({ sources: [] })).digestMarkdown();
    expect(digest).toContain("No knowledge sources resolved");
  });

  it("lists decisions and deferred items", () => {
    const digest = new MarkdownAdapter(ctx({ decisionsDir: "docs/decisions" })).digestMarkdown();
    expect(digest).toContain("**DEC-001** Use PostgreSQL");
    expect(digest).toContain("Deferred / out-of-scope");
  });
});

describe("isTopicLike", () => {
  it.each([
    ["Delivery notes", true],
    ["Overview", false],
    ["TODO", false],
    ["12", false],
    ["ab", false],
    ["a heading long enough to be prose rather than a topic", false],
  ])("%s → %s", (name, expected) => {
    expect(isTopicLike(name)).toBe(expected);
  });
});
