/**
 * Layout resolution — the geometry layer of the display model (design D1/D2).
 *
 * A window declares a `layout` id and assigns a box to each of that layout's
 * positions. This module turns that pair, or the legacy `slots` list, into the one
 * canonical `ResolvedWindow` shape the server and the client consume. Resolving
 * here (rather than in either of them) is what lets the two stay ignorant of the
 * legacy form entirely.
 *
 * Posture matches the rest of the wall: a window naming an unknown layout, or
 * leaving a position empty, is dropped or skipped with a warning — never rendered
 * blank and never fatal. An empty page and a broken page look identical to the
 * operator, and only one of them prints a reason.
 */

import type { Audience, ResolvedBox, ResolvedWindow, WallBox, WallLayout, WallWindow } from "./types.js";

/** The stacked, one-column arrangement the wall had before layouts existed (design D9). */
export const STACKED_LAYOUT_ID = "stacked";

/** Position names used by a layout, in row-major order, deduped. */
export function layoutPositions(layout: WallLayout): string[] {
  const seen: string[] = [];
  for (const row of layout.areas) {
    for (const cell of row) {
      if (cell && cell !== "." && !seen.includes(cell)) seen.push(cell);
    }
  }
  return seen;
}

/** Every row of a well-formed grid has the same cell count. */
function badLayout(layout: WallLayout): string | null {
  if (!Array.isArray(layout.areas) || layout.areas.length === 0) return "areas must be a non-empty array";
  const width = layout.areas[0].length;
  if (width === 0) return "areas rows must be non-empty";
  if (layout.areas.some((r) => !Array.isArray(r) || r.length !== width)) {
    return `all areas rows must have ${width} cells`;
  }
  if (layout.columns && layout.columns.length !== width) {
    return `columns must have ${width} entries to match areas`;
  }
  if (layout.rows && layout.rows.length !== layout.areas.length) {
    return `rows must have ${layout.areas.length} entries to match areas`;
  }
  return badSpan(layout);
}

/**
 * A position occupying several cells must be a RECTANGLE.
 *
 * CSS Grid rejects a non-rectangular `grid-template-areas` value wholesale — it does not
 * render an approximation, it drops the property, and the page comes up with no layout at
 * all. An empty page and a broken page look identical to the operator, so a layout the
 * browser will refuse must never reach the browser.
 *
 * Nothing hit this while every shipped layout had single-cell positions; the first
 * row-spanning layout walks straight into it. The check is a bounding box: take each
 * position's min/max row and column, and require every cell inside those bounds to carry
 * the same name. That rejects both the L-shape and the diagonal with one rule.
 */
function badSpan(layout: WallLayout): string | null {
  const bounds = new Map<string, { r0: number; r1: number; c0: number; c1: number }>();
  layout.areas.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (!cell || cell === ".") return;
      const b = bounds.get(cell);
      if (!b) { bounds.set(cell, { r0: r, r1: r, c0: c, c1: c }); return; }
      b.r0 = Math.min(b.r0, r); b.r1 = Math.max(b.r1, r);
      b.c0 = Math.min(b.c0, c); b.c1 = Math.max(b.c1, c);
    });
  });
  for (const [name, b] of bounds) {
    for (let r = b.r0; r <= b.r1; r++) {
      for (let c = b.c0; c <= b.c1; c++) {
        if (layout.areas[r][c] !== name) {
          return `position "${name}" is not rectangular — its cells must form a solid block`;
        }
      }
    }
  }
  return null;
}

/**
 * Decide who is watching this window — FAIL CLOSED (wall-public-surface D1/D2).
 *
 * Every public-zone protection keys off this: which redacted variant is broadcast, which
 * accumulation slice is replayed, whether `stage-expired` is suppressed, how a `show` is
 * zoned. It used to be INFERRED as `!zones.includes("private")`, which conflated "what may
 * this window display?" with "is an audience looking at it?" — so widening a public
 * window's zones to show more silently turned redaction off in front of a room.
 *
 * Three rules, all pointing the same way:
 *
 * 1. Absent or unreadable → `"public"`. The protected reading. Note this INVERTS the old
 *    inference, where an unrecognized zone list yielded "not public → no redaction".
 * 2. `"operator"` plus no `private` zone is a contradiction the old code could not express;
 *    it warns and resolves public, because an operator view that renders no private content
 *    is far more likely to be a mislabelled public wall than a deliberate configuration.
 * 3. A project config predating this field gets rule 1 — so a custom private view becomes
 *    MORE redacted than before. That is the deliberate direction: a wall that redacts
 *    content it did not need to is an annoyance; a wall that failed to redact is the thing
 *    this exists to prevent. The warning names the window and the one-field fix.
 */
function resolveAudience(win: WallWindow, warn: (msg: string) => void): Audience {
  const declared = win.audience;
  if (declared !== "public" && declared !== "operator") {
    if (declared !== undefined) {
      warn(`[set-copilot] wall: window "${win.name}" declares an unknown audience ${JSON.stringify(declared)} — treating it as PUBLIC (redaction on). Use "public" or "operator".`);
    } else if (!win.zones.includes("private")) {
      // A window that shows no private content and declares nothing: public either way,
      // under both the old inference and the new default. Nothing to warn about.
    } else {
      warn(`[set-copilot] wall: window "${win.name}" renders private-zone events but declares no audience — treating it as PUBLIC (redaction on, private events withheld). Add \`"audience": "operator"\` if this is your own view.`);
    }
    return "public";
  }
  if (declared === "operator" && !win.zones.includes("private")) {
    warn(`[set-copilot] wall: window "${win.name}" declares audience "operator" but renders no private zone — resolving as PUBLIC (the protected reading).`);
    return "public";
  }
  return declared;
}

/** Build the implicit one-column layout a legacy `slots` window resolves onto. */
function stackedLayoutFor(areas: string[]): WallLayout {
  return { id: STACKED_LAYOUT_ID, areas: areas.map((a) => [a]) };
}

/**
 * Resolve one window against the layout registry.
 *
 * Returns null (with a reason) when the window cannot be rendered at all: an
 * unknown layout id, a malformed layout, or no boxes. A position left without a
 * box is a warning, not a failure — the rest of the window still renders.
 */
export function resolveWindow(
  win: WallWindow,
  layouts: WallLayout[],
  warn: (msg: string) => void = console.warn,
): ResolvedWindow | null {
  const base = { name: win.name, route: win.route, zones: win.zones, audience: resolveAudience(win, warn) };

  // Legacy form: a slot list becomes a stacked layout whose positions are the areas.
  if (win.slots && !win.layout) {
    if (!win.slots.length) {
      warn(`[set-copilot] wall: window "${win.name}" has no slots — dropping`);
      return null;
    }
    const boxes: ResolvedBox[] = win.slots.map((s) => ({
      position: s.area,
      behavior: s.behavior,
      cats: s.cats,
      ...(s.pacing ? { pacing: s.pacing } : {}),
    }));
    return { ...base, layout: stackedLayoutFor(win.slots.map((s) => s.area)), boxes };
  }

  const layoutId = win.layout;
  if (!layoutId) {
    warn(`[set-copilot] wall: window "${win.name}" declares neither layout nor slots — dropping`);
    return null;
  }
  const layout = layouts.find((l) => l.id === layoutId);
  if (!layout) {
    warn(`[set-copilot] wall: window "${win.name}" names unknown layout "${layoutId}" — dropping`);
    return null;
  }
  const bad = badLayout(layout);
  if (bad) {
    warn(`[set-copilot] wall: layout "${layoutId}" is malformed (${bad}) — dropping window "${win.name}"`);
    return null;
  }

  const assigned: Record<string, WallBox> = win.boxes ?? {};
  const boxes: ResolvedBox[] = [];
  for (const position of layoutPositions(layout)) {
    const box = assigned[position];
    if (!box) {
      warn(`[set-copilot] wall: window "${win.name}" leaves layout position "${position}" empty`);
      continue;
    }
    boxes.push({ ...box, position });
  }
  for (const position of Object.keys(assigned)) {
    if (!layoutPositions(layout).includes(position)) {
      warn(`[set-copilot] wall: window "${win.name}" assigns a box to "${position}", which layout "${layoutId}" does not define`);
    }
  }
  if (!boxes.length) {
    warn(`[set-copilot] wall: window "${win.name}" has no boxes — dropping`);
    return null;
  }
  return { ...base, layout, boxes };
}

/** Resolve every window, dropping the ones that cannot render (each with a reason). */
export function resolveWindows(
  windows: WallWindow[],
  layouts: WallLayout[],
  warn: (msg: string) => void = console.warn,
): ResolvedWindow[] {
  const out: ResolvedWindow[] = [];
  for (const win of windows) {
    const resolved = resolveWindow(win, layouts, warn);
    if (resolved) out.push(resolved);
  }
  return out;
}
