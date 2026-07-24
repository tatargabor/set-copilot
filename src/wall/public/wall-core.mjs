/**
 * Pure client logic — no DOM, no network — so it loads in the browser as an ES
 * module AND imports directly into a vitest file. Keeping the layout→grid mapping,
 * the category→box dispatch, and the payload→renderer choice here is what makes
 * them testable without a headless browser.
 */

/**
 * Row sizing when a layout does not declare its own `rows`. Follows the box's
 * behavior, which is what makes the shipped stacked layout render byte-identically
 * to the pre-layout wall:
 *   - a paced canvas is the hero → `2fr`
 *   - a `scroll` log stretches   → `1fr`
 *   - a pinned/plain `latest` box hugs its content → `auto`
 */
export function rowSize(box) {
  if (!box) return "auto";
  if (box.behavior === "latest" && box.pacing) return "2fr";
  if (box.behavior === "scroll") return "1fr";
  return "auto";
}

/**
 * Derive a CSS Grid template from a window's layout and boxes.
 *
 * The layout owns the geometry: `areas` is the grid row by row, `columns`/`rows`
 * are explicit track sizes. Column count comes from the grid itself — there is no
 * fixed single column any more, so horizontal, vertical, and mixed arrangements
 * are all just config. A row with no explicit size falls back to the behavior of
 * the box occupying its first named cell.
 */
export function gridTemplate(layout, boxes = []) {
  const byPosition = new Map(boxes.map((b) => [b.position, b]));
  const grid = layout.areas;
  const width = grid[0]?.length ?? 1;

  const areas = grid.map((row) => `"${row.join(" ")}"`).join(" ");
  const columns = layout.columns?.length ? layout.columns.join(" ") : Array(width).fill("1fr").join(" ");
  const rows = layout.rows?.length
    ? layout.rows.join(" ")
    : grid.map((row) => rowSize(byPosition.get(row.find((c) => c && c !== ".")))).join(" ");

  return { gridTemplateAreas: areas, gridTemplateRows: rows, gridTemplateColumns: columns };
}

/**
 * Which boxes subscribe to a category. Returns the matching box objects (a box
 * renders an event only if the event's category is in its `cats`), so one event
 * can fan out to several boxes or none.
 */
export function boxesForCategory(boxes, category) {
  return boxes.filter((b) => Array.isArray(b.cats) && b.cats.includes(category));
}

/**
 * Which renderer an event selects. The payload decides, not the box and not the
 * category's `render` default (design D3) — that is what lets one presentation box
 * hold a diagram, then a chart, then an image.
 */
export const PAYLOAD_KEYS = ["text", "graph", "chart", "image", "webpage"];

export function renderForEvent(ev) {
  for (const key of PAYLOAD_KEYS) {
    if (ev[key] !== undefined && ev[key] !== null) return key;
  }
  return null;
}

/** True when a window with these zone filters should render an event of `zone`. */
export function zoneMatches(eventZone, windowZones) {
  return eventZone === "both" || windowZones.includes(eventZone);
}
