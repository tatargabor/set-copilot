import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { globToRegExp, resolveSources } from "./sources.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sc-src-"));
  mkdirSync(join(root, "docs", "deep", "deeper"), { recursive: true });
  mkdirSync(join(root, "notes"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# readme");
  writeFileSync(join(root, "docs", "a.md"), "# a");
  writeFileSync(join(root, "docs", "deep", "b.md"), "# b");
  writeFileSync(join(root, "docs", "deep", "deeper", "c.md"), "# c");
  writeFileSync(join(root, "docs", "notes.txt"), "not markdown");
  writeFileSync(join(root, "notes", "2026-01.md"), "# jan");
  writeFileSync(join(root, "notes", "2025-12.md"), "# dec");
  writeFileSync(join(root, "node_modules", "pkg", "readme.md"), "# vendored");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const rel = (paths: string[]): string[] => paths.map((p) => relative(root, p).split("\\").join("/"));

describe("resolveSources", () => {
  it("walks a directory recursively for markdown", () => {
    expect(rel(resolveSources(root, ["docs"]))).toEqual([
      "docs/a.md",
      "docs/deep/b.md",
      "docs/deep/deeper/c.md",
    ]);
  });

  it("accepts a single file", () => {
    expect(rel(resolveSources(root, ["README.md"]))).toEqual(["README.md"]);
  });

  it("expands ** across directory levels", () => {
    expect(rel(resolveSources(root, ["docs/**/*.md"]))).toEqual([
      "docs/a.md",
      "docs/deep/b.md",
      "docs/deep/deeper/c.md",
    ]);
  });

  it("confines a single * to one segment", () => {
    expect(rel(resolveSources(root, ["docs/*.md"]))).toEqual(["docs/a.md"]);
  });

  it("matches a filename glob", () => {
    expect(rel(resolveSources(root, ["notes/2026-*.md"]))).toEqual(["notes/2026-01.md"]);
  });

  it("dedupes overlapping patterns and sorts the result", () => {
    expect(rel(resolveSources(root, ["docs", "docs/**/*.md", "docs/a.md"]))).toEqual([
      "docs/a.md",
      "docs/deep/b.md",
      "docs/deep/deeper/c.md",
    ]);
  });

  it("skips node_modules, dotfiles and non-markdown", () => {
    const all = rel(resolveSources(root, ["."]));
    expect(all).not.toContain("node_modules/pkg/readme.md");
    expect(all).not.toContain("docs/notes.txt");
  });

  it("silently skips a pattern that matches nothing", () => {
    expect(resolveSources(root, ["missing/**/*.md", "nope.md"])).toEqual([]);
  });
});

describe("globToRegExp", () => {
  it("makes **/ optional so it matches zero directories", () => {
    const re = globToRegExp("/root/docs/**/*.md");
    expect(re.test("/root/docs/a.md")).toBe(true);
    expect(re.test("/root/docs/deep/b.md")).toBe(true);
  });

  it("does not let * cross a directory separator", () => {
    const re = globToRegExp("/root/docs/*.md");
    expect(re.test("/root/docs/deep/b.md")).toBe(false);
  });

  it("escapes regex metacharacters in literal segments", () => {
    const re = globToRegExp("/root/a+b/c.md");
    expect(re.test("/root/a+b/c.md")).toBe(true);
    expect(re.test("/root/aab/cXmd")).toBe(false);
  });
});
