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
 * The smallest share of an axis a single region may be dragged down to.
 *
 * A region dragged to zero is not "small", it is *gone*: its content becomes unreachable
 * and there is no handle left to drag it back, because the handle sits on a boundary that
 * has collapsed onto the edge. 6% is small enough to be a deliberate "get this out of my
 * way" and large enough to stay grabbable at 1920×1080 (~115px on the long axis).
 */
export const MIN_TRACK_SHARE = 0.06;

/**
 * Clamp a list of track weights into shares of 1, none below `min`.
 *
 * Water-filling rather than a per-value `Math.max`: raising a starved track has to take
 * the space from somewhere, and taking it proportionally from the tracks that have room
 * is what keeps the *other* boundaries where the viewer put them. Iterated because a
 * donation can itself starve a donor; with 2–4 tracks it settles in one or two passes.
 */
function clampShares(values, min) {
  const n = values.length;
  if (!n) return values;
  const floor = Math.min(min, 1 / n); // n tracks cannot all exceed 1/n
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(total > 0)) return Array(n).fill(1 / n);
  let shares = values.map((v) => Math.max(0, v) / total);
  for (let pass = 0; pass < 8; pass++) {
    const deficit = shares.reduce((a, s) => a + Math.max(0, floor - s), 0);
    if (deficit <= 1e-9) break;
    const donors = shares.map((s) => Math.max(0, s - floor));
    const pool = donors.reduce((a, b) => a + b, 0);
    if (pool <= 1e-9) return Array(n).fill(1 / n);
    shares = shares.map((s, i) => (s < floor ? floor : s - deficit * (donors[i] / pool)));
  }
  return shares;
}

/** Parse a CSS track list ("1fr 2fr") into its track count. */
function trackCount(list) {
  return String(list || "").trim().split(/\s+/).filter(Boolean).length;
}

/** Render shares as an `fr` track list. `fr` is relative, so shares can go out as-is. */
function toFrTracks(shares) {
  return shares.map((s) => `${Number(s.toFixed(4))}fr`).join(" ");
}

/**
 * Move ONE boundary: redistribute `deltaPx` between the two tracks that meet at it.
 *
 * Returns shares of `totalPx` (an `fr` pair), or null when the input cannot describe a
 * drag. The pair's sum is conserved exactly, and each side is kept at or above the floor —
 * which is why redistribution is deliberately NOT water-filled across the other tracks
 * (wall-splitter-and-drag-fixes): the operator drags one boundary, so the geometry nobody
 * touched must not move. When the dragged pair saturates at the floor the drag stops there;
 * the pair always has room to satisfy the floor, because both sides start at or above it
 * (the rendered state was already clamped) and the sum is conserved.
 */
export function dragPairShares(totalPx, aPx, bPx, deltaPx, minShare = MIN_TRACK_SHARE) {
  const nums = [totalPx, aPx, bPx, deltaPx];
  if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  if (!(totalPx > 0) || !(aPx + bPx > 0)) return null;
  const sum = aPx + bPx;
  const floorPx = minShare * totalPx;
  // A pair this tight cannot honour the floor on both sides — split it evenly, which is
  // the only geometry that keeps either side from vanishing.
  if (sum <= 2 * floorPx) return { a: sum / 2 / totalPx, b: sum / 2 / totalPx };
  const a = Math.min(sum - floorPx, Math.max(floorPx, aPx + deltaPx));
  return { a: a / totalPx, b: (sum - a) / totalPx };
}

/**
 * Splice a dragged pair into a CSS track list, leaving every other track VERBATIM.
 *
 * This is what preserves a content-driven (`auto`) track on an axis where some other
 * boundary was dragged: the old path rewrote the whole axis from px measurements, which
 * silently converted `auto` rows to a fixed fraction — defeating "a pinned region the
 * stream cannot displace". A bad index returns the input unchanged.
 */
export function applyPairToTracks(trackList, index, a, b) {
  const tracks = String(trackList || "").trim().split(/\s+/).filter(Boolean);
  if (!Number.isInteger(index) || index < 0 || index + 1 >= tracks.length) return trackList;
  const next = tracks.slice();
  next[index] = `${Number(a.toFixed(4))}fr`;
  next[index + 1] = `${Number(b.toFixed(4))}fr`;
  return next.join(" ");
}

/**
 * Apply a viewer's viewport override to a derived grid template (wall-viewport-and-activity D3).
 *
 * An override is a per-viewer adjustment of the *track sizes* a window is rendered with —
 * what a splitter drag produces. It is deliberately a pure function over a **template**,
 * not over a window: it has no access to a box, so "the override affects geometry only" is
 * structural rather than a promise in a comment. That is also why it takes `layoutId`
 * separately instead of reaching into a layout object.
 *
 * Each axis slot (`override.columns` / `override.rows`) holds one of two forms:
 *
 *  - A **number array** (legacy): whole-axis shares, water-filled and clamped so no track
 *    falls below the floor.
 *  - A **`{pair: {index, a, b}}` object** (wall-splitter-and-drag-fixes): a single
 *    boundary's adjustment. Only the two named tracks change; every other track keeps its
 *    declared size verbatim — including a content-driven `auto`. The pair travels inside
 *    the axis key so one axis's pair adjustment can never clobber the other axis's.
 *
 * Rejection is per axis and silent-but-total: a mismatched override leaves that axis at
 * the layout's declared proportions. Two ways to mismatch, both real:
 *
 *  - **A different layout** (D2). A runtime layout switch changes what the tracks *mean*;
 *    translating an old override onto new tracks would produce a geometry nobody chose.
 *  - **A different track count** (or a malformed value). The stored override outlived an
 *    edit to the layout, or never was valid. The declared proportions are the only
 *    defensible fallback.
 *
 * @param {{gridTemplateAreas: string, gridTemplateRows: string, gridTemplateColumns: string}} template
 * @param {{layoutId?: string, columns?: number[]|{pair: object}, rows?: number[]|{pair: object}}|null|undefined} override
 * @param {string} layoutId — the id of the layout `template` was derived from
 */
export function applyViewportOverride(template, override, layoutId) {
  if (!override || typeof override !== "object") return template;
  if (override.layoutId !== layoutId) return template;

  const axis = (spec, current) => {
    // New form: one boundary's pair, spliced; untouched tracks stay verbatim.
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      const p = spec.pair;
      if (!p || typeof p !== "object") return current;
      const n = trackCount(current);
      if (!Number.isInteger(p.index) || p.index < 0 || p.index + 2 > n) return current;
      const ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
      if (!ok(p.a) || !ok(p.b) || !(p.a + p.b > 0)) return current;
      return applyPairToTracks(current, p.index, p.a, p.b);
    }
    // Legacy form: whole-axis shares.
    if (!Array.isArray(spec) || !spec.length) return current;
    if (spec.length !== trackCount(current)) return current;
    if (!spec.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) return current;
    return toFrTracks(clampShares(spec, MIN_TRACK_SHARE));
  };

  return {
    ...template,
    gridTemplateColumns: axis(override.columns, template.gridTemplateColumns),
    gridTemplateRows: axis(override.rows, template.gridTemplateRows),
  };
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

/** Default quiet threshold, shared by `connectionState` and `stripState`. */
export const QUIET_THRESHOLD_MS = 4000;

/**
 * Per-channel strip state (wall-viewport-and-activity D6).
 *
 * `connectionState` answers "is this wall showing me anything real?"; this answers "who is
 * being heard right now?". Two questions, kept apart, because the first one *gates* the
 * second: when the stream is disconnected every channel age on screen is however old the
 * last heartbeat was, and painting a confident "mic active" from a stale heartbeat is the
 * exact failure `wall-stream-recovery` exists to prevent. So a disconnected wall reports
 * `unknown`, not a remembered verdict.
 *
 * States, and why each is its own:
 *  - `active`  — heard within the threshold.
 *  - `quiet`   — captured, but nothing lately (or nothing yet).
 *  - `absent`  — not part of this capture at all. A dictation run has no system channel,
 *                and showing it as quiet would make a normal dictation look broken.
 *  - `stopped` — the capture is gone; no channel is being listened to.
 *  - `unknown` — we cannot say: no per-channel data (an older server) or a stale stream.
 *
 * @param {{captureAlive?: boolean, channels?: {mic?: object, system?: object}}|null} heartbeat
 * @param {{quietThresholdMs?: number, connection?: string}} [opts]
 * @returns {{mic: {state: string, msAgo: number|null}, system: {state: string, msAgo: number|null}}}
 */
export function stripState(heartbeat, opts = {}) {
  const quiet = opts.quietThresholdMs ?? QUIET_THRESHOLD_MS;
  const unknown = { state: "unknown", msAgo: null };

  if (!heartbeat || opts.connection === "disconnected") return { mic: unknown, system: unknown };

  const one = (ch) => {
    if (!ch || typeof ch !== "object") return unknown;
    if (ch.present === false) return { state: "absent", msAgo: null };
    if (heartbeat.captureAlive === false) return { state: "stopped", msAgo: ch.lastHeardMsAgo ?? null };
    const age = typeof ch.lastHeardMsAgo === "number" ? ch.lastHeardMsAgo : null;
    if (age !== null && age < quiet) return { state: "active", msAgo: age };
    return { state: "quiet", msAgo: age };
  };

  const chans = heartbeat.channels;
  return { mic: one(chans?.mic), system: one(chans?.system) };
}
