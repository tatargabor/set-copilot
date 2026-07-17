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
