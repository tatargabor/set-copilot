/**
 * The wall-input seam's pure validation (wall-input-to-session).
 *
 * The control-character class is the case worth pinning hardest: it must reject the
 * characters that break the one-input-is-one-JSONL-line invariant (newline, tab, NUL,
 * DEL) while passing every accented Hungarian letter and emoji — a `\b`-shaped or
 * Latin-only check would silently eat the operator's own language.
 */

import { describe, expect, it } from "vitest";

import { join } from "node:path";
import { MAX_WALL_INPUT_CHARS, normalizeWallInput, wallInputPath } from "./input.js";

describe("wallInputPath", () => {
  it("lives beside the transcript in the runtime dir", () => {
    expect(wallInputPath("/rt")).toBe(join("/rt", "wall-input.jsonl"));
  });
});

describe("normalizeWallInput", () => {
  it("accepts a plain line and trims the whitespace around it", () => {
    expect(normalizeWallInput("  rajzold újra a gráfot  ")).toEqual({ ok: true, text: "rajzold újra a gráfot" });
  });

  it("accepts accented Hungarian and emoji — the control class must not eat them", () => {
    expect(normalizeWallInput("Árvíztűrő tükörfúrógép 🚀 — őűíŐŰÍ")).toMatchObject({ ok: true });
  });

  it("rejects a non-string and an empty/whitespace text", () => {
    expect(normalizeWallInput(undefined).ok).toBe(false);
    expect(normalizeWallInput(42).ok).toBe(false);
    expect(normalizeWallInput("").ok).toBe(false);
    expect(normalizeWallInput("   ").ok).toBe(false);
  });

  it("rejects text over the cap", () => {
    expect(normalizeWallInput("a".repeat(MAX_WALL_INPUT_CHARS)).ok).toBe(true);
    expect(normalizeWallInput("a".repeat(MAX_WALL_INPUT_CHARS + 1)).ok).toBe(false);
  });

  it("rejects the characters that would break one-line-per-input", () => {
    expect(normalizeWallInput("két\nsor").ok).toBe(false);
    expect(normalizeWallInput("tab\there").ok).toBe(false);
    expect(normalizeWallInput("nul\u0000here")).toMatchObject({ ok: false });
    expect(normalizeWallInput("del\u007fhere")).toMatchObject({ ok: false });
    expect(normalizeWallInput("c1\u0085here")).toMatchObject({ ok: false });
  });
});
