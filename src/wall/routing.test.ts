import { describe, expect, it, vi } from "vitest";

import { zoneMatches, resolveEventCategory } from "./routing.js";
import { buildRegistry } from "./categories.js";
import type { DisplayEvent } from "./types.js";

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
