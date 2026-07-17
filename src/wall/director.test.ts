import { describe, expect, it } from "vitest";

import {
  emptyCanvas, offerCandidate, nextSwap, commitSwap, overrideSwap,
} from "./director.js";
import type { Pacing } from "./types.js";

const pacing: Pacing = { minDwellMs: 10_000 };

describe("director pacing", () => {
  it("shows the first candidate immediately (no current, no dwell to wait on)", () => {
    const c = emptyCanvas();
    offerCandidate(c, "v1", 0);
    expect(nextSwap(c, pacing, 0)).toBe("v1");
  });

  it("holds for the minimum dwell even when a fresher candidate exists", () => {
    const c = emptyCanvas();
    commitSwap(c, "v1", 0);
    offerCandidate(c, "v2", 4000); // fresher after 4s
    expect(nextSwap(c, pacing, 4000)).toBeNull(); // still within 10s dwell → hold
    expect(nextSwap(c, pacing, 10_000)).toBe("v2"); // dwell elapsed → swap
  });

  it("holds when nothing fresher is available", () => {
    const c = emptyCanvas();
    commitSwap(c, "v1", 0);
    expect(nextSwap(c, pacing, 20_000)).toBeNull(); // dwell elapsed but no candidate
  });

  it("swaps to the newest candidate when several are pending", () => {
    const c = emptyCanvas();
    commitSwap(c, "v1", 0);
    offerCandidate(c, "v2", 11_000);
    offerCandidate(c, "v3", 12_000);
    expect(nextSwap(c, pacing, 13_000)).toBe("v3");
  });

  it("override swaps immediately, ignoring the remaining dwell", () => {
    const c = emptyCanvas();
    commitSwap(c, "v1", 0);
    overrideSwap(c, "v2", 2000); // well within dwell
    expect(c.current?.id).toBe("v2");
    expect(c.current?.shownAt).toBe(2000);
  });

  it("does not offer the currently shown visual as a candidate", () => {
    const c = emptyCanvas();
    commitSwap(c, "v1", 0);
    offerCandidate(c, "v1", 5000);
    expect(c.pending).toHaveLength(0);
  });
});
