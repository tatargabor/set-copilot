import { describe, expect, it, vi } from "vitest";

import { zoneMatches, resolveEventCategory, windowCats } from "./routing.js";
import { buildRegistry } from "./categories.js";
import { resolveWindow } from "./layout.js";
import type { DisplayEvent, WallLayout, WallWindow } from "./types.js";

describe("zoneMatches", () => {
  it("shows a both-zone event in every window", () => {
    expect(zoneMatches("both", ["private", "both"])).toBe(true);
    expect(zoneMatches("both", ["public", "both"])).toBe(true);
  });

  it("hides a private event from a public-only window", () => {
    expect(zoneMatches("private", ["public", "both"])).toBe(false);
    expect(zoneMatches("private", ["private", "both"])).toBe(true);
  });

  it("hides a public event from a private-only window", () => {
    expect(zoneMatches("public", ["private", "both"])).toBe(false);
  });
});

describe("resolveEventCategory", () => {
  const reg = buildRegistry([{ id: "riasztás", label: "R", icon: "⚠", render: "text" }], () => {});

  it("resolves a known category", () => {
    const ev: DisplayEvent = { category: "riasztás", zone: "private", text: "x" };
    expect(resolveEventCategory(ev, reg, () => {})?.id).toBe("riasztás");
  });

  it("drops an unknown category with a warning", () => {
    const warn = vi.fn();
    const ev: DisplayEvent = { category: "ismeretlen", zone: "public", text: "x" };
    expect(resolveEventCategory(ev, reg, warn)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe("windowCats — per-box subscription filtering", () => {
  const LAYOUTS: WallLayout[] = [
    { id: "stacked", areas: [["szöveg"], ["prezentáció"]] },
    { id: "third-two-thirds", areas: [["szöveg", "prezentáció"]], columns: ["1fr", "2fr"] },
  ];
  const box = (cats: string[], extra = {}) => ({ behavior: "scroll" as const, cats, ...extra });

  it("is the union of every box's cats — the window's whole appetite", () => {
    const cats = windowCats([box(["súgás", "riasztás"]), box(["architektúra"])]);
    expect([...cats].sort()).toEqual(["architektúra", "riasztás", "súgás"]);
  });

  it("only lets through categories some box subscribes to", () => {
    const win: WallWindow = {
      name: "én", route: "/", zones: ["private", "both"], layout: "third-two-thirds",
      boxes: { szöveg: box(["súgás"]), prezentáció: box(["architektúra"]) },
    };
    const cats = windowCats(resolveWindow(win, LAYOUTS)!.boxes);
    expect(cats.has("súgás")).toBe(true);
    expect(cats.has("architektúra")).toBe(true);
    // A category no box asked for — e.g. a both-zoned hint — never reaches this window.
    expect(cats.has("metrika")).toBe(false);
  });

  it("keeps a box's subscriptions when it moves to another layout position (D2)", () => {
    const paced = box(["architektúra"]);
    const left = windowCats(resolveWindow(
      { name: "w", route: "/", zones: ["both"], layout: "third-two-thirds", boxes: { szöveg: paced } },
      LAYOUTS, () => {},
    )!.boxes);
    const right = windowCats(resolveWindow(
      { name: "w", route: "/", zones: ["both"], layout: "third-two-thirds", boxes: { prezentáció: paced } },
      LAYOUTS, () => {},
    )!.boxes);
    expect([...left]).toEqual([...right]);
  });
});
