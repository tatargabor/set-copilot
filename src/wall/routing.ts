/**
 * Pure routing helpers shared by the server (zone filtering, unknown-category
 * drop) and covered directly by unit tests. No I/O, no DOM.
 */

import type { CategoryRegistry } from "./categories.js";
import type { Category, DisplayEvent, Zone } from "./types.js";

/**
 * Does an event's zone reach a window with the given zone filter?
 *
 * A `both` event appears everywhere regardless of the filter; otherwise the
 * window's filter must list the event's zone. Window filters normally include
 * `both` too, so a `both`-tagged window still matches `both` events.
 */
export function zoneMatches(eventZone: Zone, windowZones: Zone[]): boolean {
  return eventZone === "both" || windowZones.includes(eventZone);
}

/**
 * A window's category appetite: the union of the categories its boxes subscribe
 * to. Subscription is keyed on the box, not on its position — moving a box to
 * another layout position carries its `cats` with it, exactly as it carries its
 * `behavior` and `pacing` (design D2). An event whose category is in no box's
 * `cats` never reaches this window's clients — that is how a `both`-zoned hint
 * that no box asked for stays off the public wall's wire (design D6/6.4).
 */
export function windowCats(boxes: { cats: string[] }[]): Set<string> {
  return new Set(boxes.flatMap((b) => b.cats));
}

/**
 * Resolve the category of an incoming event against the registry. Returns the
 * Category, or null (with a warning) when the category is unknown — the display
 * drops the event and keeps processing rather than rendering blank or crashing.
 */
export function resolveEventCategory(
  event: DisplayEvent,
  registry: CategoryRegistry,
  warn: (msg: string) => void = console.warn,
): Category | null {
  const cat = registry.get(event.category);
  if (!cat) {
    warn(`[set-copilot] wall: dropping event with unknown category "${event.category}"`);
    return null;
  }
  return cat;
}
