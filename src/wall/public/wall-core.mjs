/**
 * Pure client logic — no DOM, no network — so it loads in the browser as an ES
 * module AND imports directly into a vitest file. Keeping the slot→grid mapping
 * and the category→slot dispatch here is what makes task 5.6 testable without a
 * headless browser.
 */

/**
 * Derive a CSS Grid template from a window's slots. Always ONE column, one row
 * per slot, in declared order — the wall stacks top-to-bottom, never side by
 * side. Row sizing follows behavior:
 *   - a paced canvas is the hero → `2fr`
 *   - a `scroll` log stretches   → `1fr`
 *   - a pinned/plain `latest` box hugs its content → `auto`
 * The grid-area name is the slot's `area`, so the client places one element per
 * slot by name.
 */
export function rowSize(slot) {
  if (slot.behavior === "latest" && slot.pacing) return "2fr";
  if (slot.behavior === "scroll") return "1fr";
  return "auto";
}

export function gridTemplate(slots) {
  const areas = slots.map((s) => `"${s.area}"`).join(" ");
  const rows = slots.map(rowSize).join(" ");
  return { gridTemplateAreas: areas, gridTemplateRows: rows, gridTemplateColumns: "1fr" };
}

/**
 * Which slots subscribe to a category. Returns the matching slot objects (a slot
 * renders an event only if the event's category is in its `cats`), so one event
 * can fan out to several slots or none.
 */
export function slotsForCategory(slots, category) {
  return slots.filter((s) => Array.isArray(s.cats) && s.cats.includes(category));
}

/** True when a window with these zone filters should render an event of `zone`. */
export function zoneMatches(eventZone, windowZones) {
  return eventZone === "both" || windowZones.includes(eventZone);
}
