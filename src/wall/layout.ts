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

import type { ResolvedBox, ResolvedWindow, WallBox, WallLayout, WallWindow } from "./types.js";

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
  return null;
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
  const base = { name: win.name, route: win.route, zones: win.zones };

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
