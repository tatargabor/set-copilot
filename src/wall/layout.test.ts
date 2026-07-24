import { describe, expect, it, vi } from "vitest";

import { layoutPositions, resolveWindow, resolveWindows } from "./layout.js";
import type { WallLayout, WallWindow } from "./types.js";

const LAYOUTS: WallLayout[] = [
  { id: "stacked", areas: [["szöveg"], ["prezentáció"]] },
  { id: "third-two-thirds", areas: [["szöveg", "prezentáció"]], columns: ["1fr", "2fr"] },
];

const box = (cats: string[], extra = {}) => ({ behavior: "scroll" as const, cats, ...extra });

describe("layoutPositions", () => {
  it("lists positions row-major, deduped, ignoring empty cells", () => {
    expect(layoutPositions({ id: "x", areas: [["a", "a"], ["b", "."]] })).toEqual(["a", "b"]);
  });
});

describe("resolveWindow", () => {
  it("resolves a layout + boxes window into positioned boxes", () => {
    const win: WallWindow = {
      name: "én", route: "/", zones: ["private", "both"],
      layout: "third-two-thirds",
      boxes: { szöveg: box(["súgás"]), prezentáció: box(["architektúra"], { behavior: "latest" }) },
    };
    const r = resolveWindow(win, LAYOUTS)!;
    expect(r.layout.id).toBe("third-two-thirds");
    expect(r.boxes.map((b) => b.position)).toEqual(["szöveg", "prezentáció"]);
    expect(r.boxes[1].cats).toEqual(["architektúra"]);
  });

  it("moving a box to another position leaves its behavior untouched (D2)", () => {
    const paced = box(["architektúra"], { behavior: "latest", pacing: { minDwellMs: 8000 } });
    const left = resolveWindow(
      { name: "w", route: "/", zones: ["both"], layout: "third-two-thirds", boxes: { szöveg: paced } },
      LAYOUTS,
    )!;
    const right = resolveWindow(
      { name: "w", route: "/", zones: ["both"], layout: "third-two-thirds", boxes: { prezentáció: paced } },
      LAYOUTS,
    )!;
    expect(left.boxes[0].pacing).toEqual(right.boxes[0].pacing);
    expect(left.boxes[0].behavior).toBe(right.boxes[0].behavior);
  });

  it("drops a window naming an unknown layout, with a reason", () => {
    const warn = vi.fn();
    const r = resolveWindow(
      { name: "w", route: "/", zones: ["both"], layout: "nincs-ilyen", boxes: { a: box([]) } },
      LAYOUTS, warn,
    );
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown layout"));
  });

  it("warns about an empty position but still renders the rest of the window", () => {
    const warn = vi.fn();
    const r = resolveWindow(
      { name: "w", route: "/", zones: ["both"], layout: "third-two-thirds", boxes: { szöveg: box(["súgás"]) } },
      LAYOUTS, warn,
    )!;
    expect(r.boxes.map((b) => b.position)).toEqual(["szöveg"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("empty"));
  });

  it("warns about a box assigned to a position the layout does not define", () => {
    const warn = vi.fn();
    resolveWindow(
      {
        name: "w", route: "/", zones: ["both"], layout: "third-two-thirds",
        boxes: { szöveg: box(["súgás"]), nincs: box(["x"]) },
      },
      LAYOUTS, warn,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("does not define"));
  });

  it("drops a malformed layout rather than rendering a broken grid", () => {
    const warn = vi.fn();
    const bad: WallLayout[] = [{ id: "ragged", areas: [["a", "b"], ["c"]] }];
    const r = resolveWindow(
      { name: "w", route: "/", zones: ["both"], layout: "ragged", boxes: { a: box([]) } },
      bad, warn,
    );
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("malformed"));
  });

  it("resolves the legacy slots form onto a stacked layout, unchanged", () => {
    const win: WallWindow = {
      name: "régi", route: "/", zones: ["both"],
      slots: [
        { area: "pinned", behavior: "latest", cats: ["riasztás"] },
        { area: "canvas", behavior: "latest", cats: ["architektúra"], pacing: { minDwellMs: 8000 } },
      ],
    };
    const r = resolveWindow(win, LAYOUTS)!;
    expect(r.layout.areas).toEqual([["pinned"], ["canvas"]]);
    expect(r.boxes.map((b) => b.position)).toEqual(["pinned", "canvas"]);
    expect(r.boxes[1].pacing).toEqual({ minDwellMs: 8000 });
  });

  it("drops a window that declares neither layout nor slots", () => {
    const warn = vi.fn();
    expect(resolveWindow({ name: "w", route: "/", zones: ["both"] }, LAYOUTS, warn)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe("resolveWindows", () => {
  it("keeps the good windows when one is unresolvable", () => {
    const warn = vi.fn();
    const out = resolveWindows(
      [
        { name: "jó", route: "/", zones: ["both"], layout: "stacked", boxes: { szöveg: box(["súgás"]) } },
        { name: "rossz", route: "/x", zones: ["both"], layout: "hiányzó", boxes: { a: box([]) } },
      ],
      LAYOUTS, warn,
    );
    expect(out.map((w) => w.name)).toEqual(["jó"]);
  });
});
