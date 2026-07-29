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

/**
 * The status strip's state, decided from the transport's own evidence
 * (wall-stream-recovery D4).
 *
 * `wall-liveness` established the invariant one layer down: the thing whose aliveness is in
 * question cannot be the source of the aliveness signal — which is why the heartbeat is
 * derived by the server from the runtime dir rather than emitted by the copilot. But the
 * heartbeat travels over the connection whose health is in question. When the stream dies
 * the client keeps displaying the last heartbeat it got, and **a stale wall is
 * pixel-identical to a quiet one**. Only the client can observe that nothing is arriving,
 * so the same invariant, applied outward, puts this decision here.
 *
 * The primary signal is the ABSENCE of heartbeats, not `onerror`: the observed field
 * symptom is a stream that stops delivering while the object still looks open, so
 * `readyState` only refines a verdict it cannot make. The threshold is derived from the
 * interval the server actually advertises — never a second hardcoded copy of it.
 *
 * @param {{lastHeartbeatAgeMs: number|null, readyState: number, heartbeatIntervalMs: number,
 *          captureAlive?: boolean, lastHeardMsAgo?: number|null, quietThresholdMs?: number}} s
 * @returns {{state: "disconnected"|"dead"|"listening"|"quiet", label: string}}
 */
export function connectionState(s) {
  const interval = s.heartbeatIntervalMs > 0 ? s.heartbeatIntervalMs : 1000;
  // Four missed beats: long enough that a scheduling hiccup or a GC pause cannot trip it,
  // short enough that the operator learns before deciding the meeting has gone quiet.
  const deadline = interval * 4;
  const age = s.lastHeartbeatAgeMs;

  // CLOSED (2) is unambiguous. Otherwise it takes silence to convict: an OPEN stream that
  // has stopped delivering is exactly the failure this exists to catch.
  const noBeat = age == null || age > deadline;
  if (s.readyState === 2 || noBeat) {
    return { state: "disconnected", label: "⛔ nincs kapcsolat a fallal" };
  }

  // Heartbeats ARE arriving, so believe what they say. A healthy connection must never
  // suppress capture-stopped — that would trade one silent failure for another.
  if (s.captureAlive === false) return { state: "dead", label: "⚠ a capture leállt" };

  const quiet = s.quietThresholdMs ?? 4000;
  const heard = s.lastHeardMsAgo;
  if (heard != null && heard < quiet) return { state: "listening", label: "🎙 figyelek" };
  // The "N perc óta" suffix is the caller's to add: humanising a duration is a rendering
  // concern, and keeping it out of here is what leaves this function DOM-free and testable.
  return { state: "quiet", label: "💤 csend" };
}
