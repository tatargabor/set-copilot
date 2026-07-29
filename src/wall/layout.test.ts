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

  describe("a multi-cell position must be a rectangle", () => {
    /**
     * CSS Grid drops a non-rectangular `grid-template-areas` value entirely, so the page
     * comes up with NO layout — a blank wall indistinguishable from a dead server. These
     * layouts must be rejected server-side, where the warning can reach an operator.
     */
    const reject = (id: string, areas: string[][]) => {
      const warn = vi.fn();
      const r = resolveWindow(
        { name: "w", route: "/", zones: ["both"], layout: id, boxes: { a: box([]) } },
        [{ id, areas }], warn,
      );
      expect(r).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("not rectangular"));
      expect(warn.mock.calls[0][0]).toContain(id); // the layout is named, per the posture
      return warn.mock.calls[0][0] as string;
    };

    it("rejects an L-shaped position, naming it", () => {
      const msg = reject("l-shape", [["a", "a"], ["a", "b"]]);
      expect(msg).toContain('"a"');
    });

    it("rejects a diagonal position", () => {
      reject("diagonal", [["a", "b"], ["b", "a"]]);
    });

    it("resolves a full-height column span alongside per-row positions", () => {
      const warn = vi.fn();
      const areas = [["szöveg", "prezentáció"], ["szöveg", "kitűzött"]];
      const r = resolveWindow(
        {
          name: "w", route: "/", zones: ["both"], layout: "három",
          boxes: { szöveg: box([]), prezentáció: box([]), kitűzött: box([]) },
        },
        [{ id: "három", areas, columns: ["1fr", "1fr"], rows: ["2fr", "1fr"] }], warn,
      );
      expect(r).not.toBeNull();
      expect(r!.boxes.map((b) => b.position)).toEqual(["szöveg", "prezentáció", "kitűzött"]);
      expect(warn).not.toHaveBeenCalled();
    });

    it("leaves every single-cell layout resolving exactly as before", () => {
      for (const layout of LAYOUTS) {
        const warn = vi.fn();
        const boxes = Object.fromEntries(layoutPositions(layout).map((p) => [p, box([])]));
        const r = resolveWindow(
          { name: "w", route: "/", zones: ["both"], layout: layout.id, boxes },
          LAYOUTS, warn,
        );
        expect(r).not.toBeNull();
        expect(warn).not.toHaveBeenCalled();
      }
    });
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
