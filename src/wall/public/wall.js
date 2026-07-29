/**
 * The wall client. Vanilla ES module, no framework (design D3): SSE push in, one
 * slot DOM-mutation out — the whole page is never re-rendered. The only external
 * lib is Cytoscape, and only for `graph` slots; text slots are ~20-line renderers.
 */

import {
  gridTemplate, boxesForCategory, renderForEvent, connectionState, applyViewportOverride, stripState,
} from "./wall-core.mjs";
import { parseWallText } from "./text-format.mjs";
import { appendBlocks } from "./text-render.mjs";

const route = location.pathname;
const registry = new Map(); // category id → {render, icon, label}
const boxEls = new Map(); // position → { el, box, lazily-built renderers }

/** The bootstrap payload we are currently mounted on, serialized — the diff key for D5. */
let mountedFingerprint = null;
/** The heartbeat interval the SERVER advertises; 0 means this wall sends none. */
let heartbeatIntervalMs = 0;

/**
 * Fetch the window definition and mount it — but only re-derive when it actually changed.
 *
 * Called on EVERY stream open, not just at page load (wall-stream-recovery D5). The
 * bootstrap used to be fetched once, which is why a box, category or layout change needed
 * a hard reload to land. A reconnect must not flash or tear down a display that is fine,
 * so an unchanged definition is a no-op.
 */
async function bootstrapAndMount() {
  let payload;
  try {
    const res = await fetch(`/api/bootstrap?route=${encodeURIComponent(route)}`);
    if (!res.ok) { document.body.textContent = `no window for ${route}`; return false; }
    payload = await res.json();
  } catch {
    return false; // a failed re-bootstrap during a flap: keep showing what we have
  }
  const fingerprint = JSON.stringify(payload);
  if (fingerprint === mountedFingerprint) return true; // unchanged — leave the display alone
  mountedFingerprint = fingerprint;

  heartbeatIntervalMs = payload.heartbeatMs ?? 0;
  registry.clear();
  for (const c of payload.categories) registry.set(c.id, c);
  document.title = `set-copilot · ${payload.window.name}`;
  mountGrid(payload.window);
  return true;
}

async function boot() {
  if (!(await bootstrapAndMount())) return;
  connect();
  // The watchdog judges the transport from the ABSENCE of heartbeats, so it has to run on
  // its own clock — an event-driven check could never fire when nothing is arriving, which
  // is precisely the condition it exists to detect.
  setInterval(refreshStatus, 1000);
}

function mountGrid(win) {
  const root = document.getElementById("wall");
  // Remount, not append: this runs again whenever the window definition changes under a
  // live client, and the old boxes are no longer the ones being described.
  root.replaceChildren();
  boxEls.clear();
  root.style.display = "grid";
  currentLayout = win.layout;

  for (const box of win.boxes) {
    const el = document.createElement("div");
    el.className = `slot slot-${box.behavior}${box.pacing ? " slot-paced" : ""}`;
    el.style.gridArea = box.position;
    el.dataset.area = box.position;
    root.appendChild(el);
    // Renderers are built on first use, not from the box's subscriptions: a
    // presentation box may hold a graph now and a chart next, and which one it
    // gets is not knowable at mount time.
    boxEls.set(box.position, { el, box, graph: null, chart: null, panes: new Map(), shown: null, shownAt: 0, pending: null });
  }
  // After the boxes exist: a row with no declared size takes it from the box occupying it,
  // so the template can only be derived once they are known.
  applyGrid();
}

// ---- runtime layout switch (wall-chat-mirror) ----
//
// The server reshapes a window at runtime by pushing a new layout for this route. It is
// geometry only: the existing box elements keep their DOM — and with it every bit of
// state (scroll log, live graph, pacing) — and simply move to their position in the new
// grid. A box whose position the new layout does not define is hidden rather than left to
// auto-place awkwardly; it reappears if a later switch brings its position back.
function onLayout(msg) {
  if (!msg.layout || !Array.isArray(msg.layout.areas)) return;
  currentLayout = msg.layout;
  // Re-read the override for the NEW layout id (wall-viewport-and-activity D2): a switch
  // renders the incoming layout's declared proportions, not a translation of an adjustment
  // made against tracks that no longer mean the same thing. Switching back finds that
  // window's own adjustment again, because storage is keyed per layout.
  applyGrid();
  const positions = new Set(msg.layout.areas.flat().filter((c) => c && c !== "."));
  for (const entry of boxEls.values()) {
    entry.el.style.display = positions.has(entry.box.position) ? "" : "none";
  }
}

// ---- viewport override + splitters (wall-viewport-and-activity D1/D2/D3) ----
//
// A drag adjusts the TRACK SIZES this viewer renders the window with. It never reaches the
// server, never touches config, and never touches a box: the operator's laptop and the
// projected wall are different shapes with genuinely different needs, and one viewer's
// drag must not re-proportion a wall in front of an audience.
//
// The arithmetic that decides the final tracks is in `applyViewportOverride` (pure,
// unit-tested, and structurally unable to reach a box). Everything here is plumbing:
// where the handles sit, what a drag measures, and where the result is remembered.

/** The layout currently mounted — the override is keyed to it, and re-read on a switch. */
let currentLayout = null;

const OVERRIDE_PREFIX = "set-copilot:wall:viewport";

function overrideKey(layoutId) {
  return `${OVERRIDE_PREFIX}:${route}:${layoutId}`;
}

function readOverride(layoutId) {
  try {
    const raw = localStorage.getItem(overrideKey(layoutId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private-mode storage, or a corrupt entry: declared proportions win
  }
}

function writeOverride(o) {
  try { localStorage.setItem(overrideKey(o.layoutId), JSON.stringify(o)); } catch { /* not fatal */ }
}

function clearOverride(layoutId) {
  try { localStorage.removeItem(overrideKey(layoutId)); } catch { /* not fatal */ }
}

/**
 * Derive the grid template, apply this viewer's override, paint it, and rebuild the handles.
 *
 * The single place the grid is written. Mount, a runtime layout switch, a drag and a reset
 * all funnel through here, so there is exactly one description of what geometry the window
 * has — the failure mode otherwise is a drag that survives a layout switch on one path and
 * not another.
 */
function applyGrid() {
  const root = document.getElementById("wall");
  if (!root || !currentLayout) return;
  const boxes = [...boxEls.values()].map((e) => e.box);
  const base = gridTemplate(currentLayout, boxes);
  const t = applyViewportOverride(base, readOverride(currentLayout.id), currentLayout.id);
  root.style.gridTemplateAreas = t.gridTemplateAreas;
  root.style.gridTemplateRows = t.gridTemplateRows;
  root.style.gridTemplateColumns = t.gridTemplateColumns;
  buildHandles(root);
  updateResetAffordance();
}

/** Track sizes as the browser has actually resolved them, in px. */
function resolvedTracks(root, axis) {
  const cs = getComputedStyle(root);
  const raw = axis === "columns" ? cs.gridTemplateColumns : cs.gridTemplateRows;
  return String(raw).split(/\s+/).map(parseFloat).filter((n) => Number.isFinite(n));
}

/**
 * One handle per internal boundary, on both axes.
 *
 * Grid children can be placed by line number even under named areas, so a column handle is
 * a full-height item in the column left of the boundary, pinned to its trailing edge and
 * pulled half its width outward — it straddles the gap instead of stealing space from
 * either region. That is what keeps the handles out of the layout arithmetic entirely:
 * they occupy no track of their own.
 */
function buildHandles(root) {
  for (const old of [...root.querySelectorAll(".splitter")]) old.remove();
  const cols = currentLayout.areas[0]?.length ?? 1;
  const rows = currentLayout.areas.length;

  for (let i = 0; i < cols - 1; i++) root.appendChild(makeHandle("columns", i, rows, cols));
  for (let i = 0; i < rows - 1; i++) root.appendChild(makeHandle("rows", i, rows, cols));
}

function makeHandle(axis, index, rows, cols) {
  const h = document.createElement("div");
  h.className = `splitter splitter-${axis === "columns" ? "v" : "h"}`;
  h.dataset.axis = axis;
  h.dataset.index = String(index);
  h.setAttribute("role", "separator");
  h.setAttribute("aria-orientation", axis === "columns" ? "vertical" : "horizontal");
  h.title = "Húzd el a határt · dupla kattintás: alaphelyzet";
  if (axis === "columns") {
    h.style.gridColumn = `${index + 1}`;
    h.style.gridRow = `1 / ${rows + 1}`;
  } else {
    h.style.gridRow = `${index + 1}`;
    h.style.gridColumn = `1 / ${cols + 1}`;
  }
  h.addEventListener("pointerdown", (ev) => startDrag(ev, axis, index));
  // A double-click on a boundary resets that axis — the affordance you reach for while
  // your hand is already on the thing you over-dragged.
  h.addEventListener("dblclick", () => resetViewport());
  return h;
}

function startDrag(ev, axis, index) {
  const root = document.getElementById("wall");
  if (!root || !currentLayout) return;
  const sizes = resolvedTracks(root, axis);
  if (sizes.length < index + 2) return;
  const startPos = axis === "columns" ? ev.clientX : ev.clientY;
  ev.target.setPointerCapture?.(ev.pointerId);
  ev.preventDefault();
  document.body.classList.add(axis === "columns" ? "dragging-col" : "dragging-row");

  const move = (m) => {
    const delta = (axis === "columns" ? m.clientX : m.clientY) - startPos;
    const next = sizes.slice();
    next[index] = sizes[index] + delta;
    next[index + 1] = sizes[index + 1] - delta;
    // Push px through the pure function: it normalises to shares and clamps, so a drag
    // past a region's floor stops there instead of collapsing it.
    const o = readOverride(currentLayout.id) ?? { layoutId: currentLayout.id };
    o.layoutId = currentLayout.id;
    o[axis] = next;
    writeOverride(o);
    applyGrid();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("dragging-col", "dragging-row");
    // The regions changed size; an auto-fitting graph should follow (D4 meets D1 here).
    for (const entry of boxEls.values()) entry.graph?.refit?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/**
 * Return to the layout's declared proportions.
 *
 * Placement (design open question): the strip, plus a double-click on any boundary. The
 * strip is the one piece of furniture guaranteed to exist in every window and every layout
 * — the same reason the liveness status lives there — so the escape hatch cannot be hidden
 * by a layout that fills every position. It appears only while an override is in effect,
 * so a wall nobody has dragged carries no extra chrome.
 */
function resetViewport() {
  if (!currentLayout) return;
  clearOverride(currentLayout.id);
  applyGrid();
  for (const entry of boxEls.values()) entry.graph?.refit?.();
}

function updateResetAffordance() {
  const btn = document.getElementById("viewport-reset");
  if (!btn) return;
  btn.hidden = !(currentLayout && readOverride(currentLayout.id));
}

/** The live EventSource — read for `readyState`, which refines the watchdog's verdict. */
let es = null;

function connect() {
  es = new EventSource(`/events?route=${encodeURIComponent(route)}`);
  // The browser reconnects natively (the server writes `retry: 2000`) and re-presents the
  // last `id:` it saw as `Last-Event-ID`, so the server can send just the missed span. All
  // this handler has to do is pick up config changes that landed while we were away.
  es.onopen = () => { bootstrapAndMount(); refreshStatus(); };
  es.onerror = () => refreshStatus();
  es.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.kind === "show") return onShow(msg);
    if (msg.kind === "heartbeat") return onHeartbeat(msg);
    if (msg.kind === "pending") return onPending(msg);
    if (msg.kind === "stage-expired") return onStageExpired(msg);
    if (msg.kind === "layout") return onLayout(msg);
    if (msg.kind === "replay") return onFullReplay();
    onEvent(msg);
  };
}

/**
 * The server could not satisfy our resume and is sending full state instead.
 *
 * Rebuild rather than append: a full replay legitimately repeats content we may still be
 * showing, so appending would double every line. The server announces this branch for
 * exactly that reason — it is the honest failure, not a silent one.
 */
function onFullReplay() {
  for (const entry of boxEls.values()) {
    entry.el.replaceChildren();
    entry.graph = null;
    entry.chart = null;
    entry.panes = new Map();
    entry.shown = null;
    entry.shownAt = 0;
    entry.pending = null;
    entry.pendingOverlay = null;
    clearTimeout(entry.pendingTimer);
    clearTimeout(entry.pendingTtl);
  }
}

// ---- liveness status strip (wall-liveness) ----
//
// The server pushes a heartbeat on a timer, derived from the runtime dir, not from the
// copilot — so this strip stays truthful even when the copilot is silent or stuck. The
// "N mp / N perc" humanising is client-side; the server sends only raw ms.

/** Below this age the capture counts as actively hearing speech; above it, quiet. */
const QUIET_THRESHOLD_MS = 4000;
let statusEl = null;

function humanAge(ms) {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} mp`;
  const m = Math.round(s / 60);
  return `${m} perc`;
}

/** The last heartbeat received, and WHEN — its arrival time is the transport evidence. */
let lastHb = null;
let lastHeartbeatAt = null;

function onHeartbeat(hb) {
  lastHb = hb;
  lastHeartbeatAt = Date.now();
  refreshStatus();
}

/**
 * Paint the status strip from the transport's evidence plus the last heartbeat's contents.
 *
 * The decision itself lives in `connectionState` (DOM-free, unit-tested); this only
 * renders it. A wall that is not receiving must not be able to look like a wall with
 * nothing to say — before this, a dead stream simply froze the last heartbeat on screen,
 * and a stale wall was pixel-identical to a quiet one.
 */
/**
 * The strip's parts, built once.
 *
 * `textContent = …` used to rebuild the whole strip every second, which is fine for a
 * sentence and wrong for indicators: a per-channel dot that is re-created on every tick
 * restarts its own animation, so an "active" channel would never actually look alive.
 */
let stripParts = null;

const CHANNEL_LABELS = {
  mic: { icon: "🎙", name: "én" },
  system: { icon: "🔊", name: "mások" },
};

function ensureStrip() {
  if (!statusEl) statusEl = document.getElementById("status-strip");
  if (!statusEl) return null;
  if (stripParts && statusEl.contains(stripParts.label)) return stripParts;

  statusEl.replaceChildren();
  const label = document.createElement("span");
  label.className = "status-label";
  statusEl.appendChild(label);

  const chans = {};
  const group = document.createElement("span");
  group.className = "chan-group";
  for (const key of ["mic", "system"]) {
    const c = document.createElement("span");
    c.className = `chan chan-${key}`;
    const icon = document.createElement("span");
    icon.className = "chan-icon";
    icon.textContent = CHANNEL_LABELS[key].icon;
    const bar = document.createElement("span");
    bar.className = "chan-bar";
    const name = document.createElement("span");
    name.className = "chan-name";
    name.textContent = CHANNEL_LABELS[key].name;
    c.append(icon, name, bar);
    group.appendChild(c);
    chans[key] = c;
  }
  statusEl.appendChild(group);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.id = "viewport-reset";
  reset.className = "viewport-reset";
  reset.textContent = "⤢ arányok alaphelyzetbe";
  reset.hidden = true;
  reset.addEventListener("click", resetViewport);
  statusEl.appendChild(reset);

  stripParts = { label, chans };
  updateResetAffordance();
  return stripParts;
}

const CHANNEL_STATE_TEXT = {
  active: "beszél", quiet: "csendben", absent: "nincs csatorna", stopped: "leállt", unknown: "nem tudni",
};

/**
 * Paint the status strip from the transport's evidence plus the last heartbeat's contents.
 *
 * The decision itself lives in `connectionState` / `stripState` (DOM-free, unit-tested);
 * this only renders it. A wall that is not receiving must not be able to look like a wall
 * with nothing to say — before this, a dead stream simply froze the last heartbeat on
 * screen, and a stale wall was pixel-identical to a quiet one.
 */
function refreshStatus() {
  const parts = ensureStrip();
  if (!parts) return;
  if (!heartbeatIntervalMs) return; // this wall sends no heartbeats — nothing to judge
  const st = connectionState({
    lastHeartbeatAgeMs: lastHeartbeatAt == null ? null : Date.now() - lastHeartbeatAt,
    readyState: es ? es.readyState : 2,
    heartbeatIntervalMs,
    captureAlive: lastHb ? lastHb.captureAlive : undefined,
    lastHeardMsAgo: lastHb ? lastHb.lastHeardMsAgo : null,
    quietThresholdMs: QUIET_THRESHOLD_MS,
  });
  statusEl.classList.remove("status-listening", "status-quiet", "status-dead", "status-disconnected");
  statusEl.classList.add(`status-${st.state}`);
  const age = lastHb ? lastHb.lastHeardMsAgo : null;
  parts.label.textContent = st.state === "quiet" && age != null
    ? `${st.label} · ${humanAge(age)} óta`
    : st.label;

  // Per-channel indicators (D6): a shape and a colour, not a sentence — the strip is read
  // at wall distance, where "which channel is live" has to survive not being read at all.
  const chans = stripState(lastHb, { quietThresholdMs: QUIET_THRESHOLD_MS, connection: st.state });
  for (const key of ["mic", "system"]) {
    const el = parts.chans[key];
    const s = chans[key];
    el.className = `chan chan-${key} chan-${s.state}`;
    const name = CHANNEL_LABELS[key].name;
    el.title = s.msAgo != null && s.state === "quiet"
      ? `${name}: ${CHANNEL_STATE_TEXT[s.state]} (${humanAge(s.msAgo)} óta)`
      : `${name}: ${CHANNEL_STATE_TEXT[s.state]}`;
  }
}

// ---- pending placeholder (wall-pending-indicator) ----
//
// A fork-based draw takes seconds; the copilot marks its target box pending so a
// spinner appears at once. It overlays the box rather than replacing content, and is
// cleared either by the first real render (see applyToBox) or by its own ttl — so a
// crashed fork never strands a permanent spinner.

function onPending(p) {
  for (const entry of boxEls.values()) {
    if (!entry.box.cats.includes(p.category)) continue;
    showPendingMarker(entry, p);
  }
}

function showPendingMarker(entry, p) {
  let overlay = entry.pendingOverlay;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "pending-overlay";
    overlay.innerHTML = `<span class="pending-spinner">⏳</span><span class="pending-label"></span>`;
    entry.el.appendChild(overlay);
    entry.pendingOverlay = overlay;
  }
  overlay.querySelector(".pending-label").textContent = p.label ?? "";
  overlay.hidden = false;
  clearTimeout(entry.pendingTtl);
  const ttl = typeof p.ttlMs === "number" && p.ttlMs > 0 ? p.ttlMs : 20000;
  entry.pendingTtl = setTimeout(() => hidePending(entry), ttl);
}

function hidePending(entry) {
  clearTimeout(entry.pendingTtl);
  if (entry.pendingOverlay) entry.pendingOverlay.hidden = true;
}

// ---- predictive staging (predictive-staging) ----
//
// A staged prediction is prepared privately (this view only ever sees it if it is a
// private view). It wears a "prepared" badge so the operator can tell a guess apart from
// established content, and an expiry marker releases a prediction the conversation left
// behind — a guess must never quietly harden into fact on the wall.

/** Toggle a corner badge on a box that is showing a staged (or expired) prediction. */
function markStage(entry, text, expired) {
  let badge = entry.el.querySelector(":scope > .stage-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "stage-badge";
    entry.el.appendChild(badge);
  }
  badge.textContent = text;
  badge.classList.toggle("stage-expired", Boolean(expired));
}

function onStageExpired(m) {
  for (const entry of boxEls.values()) {
    if (!entry.box.cats.includes(m.category)) continue;
    entry.el.classList.add("stage-dim");
    markStage(entry, "⌛ elévült jóslat", true);
  }
}

// ---- routing ----

function onEvent(ev) {
  const cat = registry.get(ev.category);
  if (!cat) return; // unknown category → drop, keep going
  const render = renderForEvent(ev); // the PAYLOAD decides, not the category
  if (!render) return;
  for (const entry of boxEls.values()) {
    if (!boxesForCategory([entry.box], ev.category).length) continue;
    applyToBox(entry, render, cat, ev);
  }
}

/**
 * Hand one event to one box, building that box's renderer on first use.
 *
 * A box holding several render types swaps between them, and a swap tears down the
 * previous renderer's DOM — otherwise a chart would be drawn on top of a live
 * Cytoscape canvas. Text is exempt: `scroll` text accumulates, and clearing it on
 * every line would make the log useless.
 */
function applyToBox(entry, render, cat, ev) {
  // Redaction observability (public-redaction D7): the server sets `ev.redaction`
  // only on the PRIVATE copy of an event whose public variant was scrubbed or
  // withheld. Mark the box regardless of payload type, so a redacted graph label or
  // chart title is as visible to the operator as a redacted text line.
  markRedaction(entry, ev);

  // Any real payload for this box clears a pending placeholder it was showing
  // (wall-pending-indicator: "Real content clears the placeholder").
  hidePending(entry);

  // A staged prediction wears a "prepared" badge so a guess is visibly distinct from
  // established content (predictive-staging); a fresh staged draw clears a prior expiry.
  if (ev.staged) {
    entry.el.classList.remove("stage-dim");
    markStage(entry, "🔮 előkészítve", false);
  }

  if (render === "text") {
    show(entry, "text");
    renderText(paneFor(entry, "text"), entry.box, cat, ev);
    return;
  }

  // A render-type change in a PACED box is a canvas swap and obeys the dwell.
  // Without this, a chart arriving mid-dwell wipes the graph the director is still
  // holding — the default presentation box subscribes to both, so this is the
  // common case, not an edge case. `priority:"immediate"` bypasses it, as everywhere.
  if (entry.shown && entry.shown !== render && entry.box.pacing && ev.priority !== "immediate") {
    const remaining = (entry.box.pacing.minDwellMs ?? 0) - (Date.now() - (entry.shownAt ?? 0));
    if (remaining > 0) {
      entry.pending = { render, cat, ev };
      clearTimeout(entry.pendingTimer);
      entry.pendingTimer = setTimeout(() => {
        const p = entry.pending;
        entry.pending = null;
        if (p) applyToBox(entry, p.render, p.cat, p.ev);
      }, remaining);
      return;
    }
  }

  // Media is loaded BEFORE the box is touched: a source that fails must leave the
  // previous content standing, and a box cleared first then failed is empty — which
  // is indistinguishable from a dead wall, the one signal the operator relies on.
  if (render === "image" || render === "webpage") {
    const node = render === "image" ? buildImage(ev.image) : buildWebpage(ev.webpage);
    if (!node) return; // malformed spec: nothing rendered, nothing destroyed
    whenReady(node, () => {
      paneFor(entry, render).replaceChildren(node.root);
      show(entry, render);
    });
    return;
  }

  show(entry, render);
  if (render === "graph") {
    entry.graph = entry.graph || makeGraphSlot(paneFor(entry, "graph"));
    entry.graph.apply(ev);
  } else if (render === "chart") {
    entry.chart = entry.chart || makeChartSlot(paneFor(entry, "chart"));
    entry.chart.apply(ev);
  }
}

/** Swap in only once the media has actually loaded; on failure, leave the box alone. */
function whenReady(node, swapIn) {
  if (!node.awaits) return swapIn();
  node.awaits.onload = () => swapIn();
  node.awaits.onerror = () => console.warn("[wall] media failed to load, keeping previous content:", node.src);
}

/**
 * One pane per render type inside a box, created on demand and never destroyed.
 *
 * Swapping HIDES the other panes rather than clearing the box. Clearing looked
 * cheaper and was wrong three ways: it threw away the graph renderer's accumulated
 * `visuals` (so a later `op:"add"` drew an empty graph, and the director never
 * re-sends a `show` for an already-committed visual — the box stayed blank for
 * good), it destroyed a `scroll` box's whole text log, and neither is recoverable
 * because replay does not carry scroll history.
 */
function paneFor(entry, render) {
  let pane = entry.panes.get(render);
  if (!pane) {
    pane = document.createElement("div");
    pane.className = `pane pane-${render}`;
    entry.el.appendChild(pane);
    entry.panes.set(render, pane);
  }
  return pane;
}

function show(entry, render) {
  if (entry.shown !== render) {
    entry.shown = render;
    entry.shownAt = Date.now();
  }
  paneFor(entry, render);
  for (const [kind, pane] of entry.panes) pane.hidden = kind !== render;
}

function onShow(cmd) {
  for (const entry of boxEls.values()) {
    if (!entry.graph || !entry.box.cats.includes(cmd.cat)) continue;
    // A show is broadcast once per visual, so a throw here used to abort the rest
    // of the loop AND the SSE handler — one malformed delta could take the whole
    // page down until reload.
    try {
      entry.graph.show(cmd.id);
    } catch (e) {
      console.warn("[wall] show failed for", cmd.cat, cmd.id, e);
    }
  }
}

// ---- text renderers (scroll / latest) ----

/**
 * Toggle a corner badge on a box when an event carries a redaction marker
 * (public-redaction D7). Payload-agnostic on purpose: a graph or chart cannot mark
 * an individual leaf, so the whole box gets the badge — the operator sees *that*
 * something on this box went out scrubbed or withheld to the public wall.
 *
 * `ev.redaction` is present only on the private copy the server sends to a private
 * view, so this never fires on the public wall itself.
 */
function markRedaction(entry, ev) {
  if (!ev || !ev.redaction) return;
  let badge = entry.el.querySelector(":scope > .redaction-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "redaction-badge";
    entry.el.appendChild(badge);
  }
  const withheld = ev.redaction === "withheld";
  badge.textContent = withheld ? "⊘ visszatartva" : "✂ redaktálva";
  badge.title = withheld
    ? "A publikus falon ez az esemény nem jelent meg."
    : "A publikus falon ez az esemény kitakarva jelent meg.";
}

function renderText(el, box, cat, ev) {
  const line = document.createElement("div");
  line.className = "line";
  if (ev.speaker) line.classList.add(`speaker-${ev.speaker}`); // mic="én" vs system
  if (ev.priority === "immediate") line.classList.add("immediate");
  if (ev.redaction) line.classList.add(`redaction-${ev.redaction}`); // private-view marker
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = clock();
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = cat.icon ?? "";
  const txt = document.createElement("span");
  txt.className = "txt";
  // Formatting is DERIVED from the plain string at render time — the payload is still one
  // string, so producers, the redaction funnel (which ran server-side, before this) and
  // the replayed accumulated state are all untouched.
  appendBlocks(txt, parseWallText(ev.text ?? ""));
  line.append(time, icon, txt);

  if (box.behavior === "latest") {
    el.replaceChildren(line); // only the newest survives
  } else {
    // scroll: newest on top, older lines flow down — no auto-scroll to chase, the
    // fresh line is always at the visible top edge.
    el.insertBefore(line, el.firstChild);
    el.scrollTop = 0;
  }
}

/**
 * Wall-clock HH:MM:SS for the moment a line is shown. On a live wall arrival ≈
 * utterance time, and replay carries no scroll history (only the last pinned line),
 * so a client-side stamp has nothing older to be wrong about — 24h, seconds
 * included so rapid lines stay distinguishable.
 */
function clock() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// ---- media renderers (image / webpage) ----
//
// A load failure keeps the previous content instead of clearing the box: an empty
// box is visually indistinguishable from a dead wall, and that is the one signal
// the operator relies on.

/** Only these reach the DOM. The client re-checks the scheme it was handed. */
function isHttp(u) {
  return /^https?:\/\//i.test(String(u)); // case-insensitive: HTTPS:// is a valid URL
}

function buildImage(spec) {
  if (!spec || typeof spec.src !== "string" || !spec.src) return null;
  const img = document.createElement("img");
  img.className = "media-image";
  img.alt = spec.caption ?? "";
  // A remote URL loads directly; anything else goes through /media, which re-derives
  // confinement server-side rather than trusting the emitted path.
  img.src = isHttp(spec.src) ? spec.src : `/media?src=${encodeURIComponent(spec.src)}`;

  const figure = document.createElement("figure");
  figure.className = "media";
  figure.appendChild(img);
  if (spec.caption) {
    const cap = document.createElement("figcaption");
    cap.textContent = spec.caption;
    figure.appendChild(cap);
  }
  return { root: figure, awaits: img, src: spec.src };
}

function buildWebpage(spec) {
  // Scheme is re-checked here, not only at ingest: `javascript:` and `data:text/html`
  // in an iframe src execute attacker markup, and the client must not depend on
  // every producer having gone through validation.
  if (!spec || typeof spec.url !== "string" || !isHttp(spec.url)) return null;
  const frame = document.createElement("iframe");
  frame.className = "media-frame";
  frame.src = spec.url;
  frame.title = spec.title ?? spec.url;
  // Display, not a runtime (a Non-Goal of this change): the embedded document gets
  // scripts so ordinary pages render, but omitting `allow-same-origin` puts it in an
  // opaque origin — no access to the wall's DOM, no top-level navigation, no
  // downloads, no popups.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  // An iframe fires `load` even for an error page, so it swaps in either way; there
  // is no cross-origin way to tell, and a blank frame at least replaced deliberately.
  return { root: frame, awaits: frame, src: spec.url };
}

// ---- graph renderer (Cytoscape) ----

/**
 * Continuous auto-fit with a viewer override (wall-viewport-and-activity D4).
 *
 * The mode is one bit per visual, and the viewer always wins: fitting is automatic until
 * they set a scale, then it is theirs until they explicitly hand it back. A delta arriving
 * mid-inspection re-renders content without yanking the view — the thing that makes a
 * growing graph unusable to look at.
 *
 * The mode is per VISUAL rather than per box on purpose: a `reset` introducing a new visual
 * is a topic change, and inheriting a scale chosen for the previous diagram into the next
 * one is the case that feels broken.
 */
function makeGraphSlot(el) {
  const visuals = new Map(); // visual id → { nodes:Map, edges:[] }
  const fitModes = new Map(); // visual id → "auto" | "manual"
  let shown = null;
  let cy = null;
  /**
   * Viewport moves before this timestamp are OURS, not the viewer's.
   *
   * A boolean flag released on the next frame is not enough: an animated layout keeps
   * emitting `zoom`/`pan` for its whole duration, so the tail of our own fit arrived after
   * the flag cleared and was read as the viewer taking control — every automatic fit
   * silently switched the graph to manual, which is precisely backwards. A deadline covers
   * the animation; the cost is that a viewer who grabs the graph within that window has to
   * grab it again.
   */
  let quietUntil = 0;

  /**
   * The graph's palette, read from the same CSS variables everything else uses.
   *
   * Cytoscape paints to a canvas, so it cannot inherit CSS — its colours have to be handed
   * to it. Hardcoding them meant the graph stayed dark-on-dark while the rest of the wall
   * followed the viewer's theme: on a light projector the diagram was the one element that
   * did not belong to the page (D7 covers both themes).
   */
  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
    return {
      node: v("--line", "#22304a"),
      border: v("--accent", "#4f8cff"),
      ink: v("--text", "#e7ecf5"),
      edge: v("--muted", "#8aa0c0"),
    };
  }

  function graphStyle() {
    const c = palette();
    return [
      // width/height "label" + padding size the box to its text, so labels
      // like "transcript.jsonl" never overflow the box.
      { selector: "node", style: { label: "data(label)", "background-color": c.node, "border-color": c.border, "border-width": 1.5, color: c.ink, "font-size": 12, "text-valign": "center", "text-halign": "center", width: "label", height: "label", padding: "10px", shape: "round-rectangle", "text-wrap": "wrap", "text-max-width": "140px" } },
      { selector: "edge", style: { width: 2, "line-color": c.edge, "target-arrow-color": c.edge, "target-arrow-shape": "triangle", "curve-style": "bezier" } },
    ];
  }

  function ensureCy() {
    if (cy || typeof window.cytoscape !== "function") return cy;
    cy = window.cytoscape({ container: el, style: graphStyle() });
    // Follow a theme change without a reload — the OS flipping to light mid-meeting is
    // exactly when nobody wants to restart the wall.
    window.matchMedia?.("(prefers-color-scheme: light)")
      ?.addEventListener?.("change", () => { try { cy.style(graphStyle()); } catch { /* not fatal */ } });
    // The viewer's own wheel/drag is what switches to manual. Cytoscape fires the same
    // event for our programmatic fits, hence the flag rather than a listener we detach.
    cy.on("zoom pan", () => { if (Date.now() >= quietUntil && shown) setMode(shown, "manual"); });
    // A region that changed size (a splitter drag, a window resize) needs the canvas
    // remeasured — and re-fitted, but only while fitting is still ours to do.
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => refit()).observe(el);
    }
    return cy;
  }

  function isAuto(id) {
    return (fitModes.get(id) ?? "auto") === "auto";
  }

  function setMode(id, mode) {
    fitModes.set(id, mode);
    updateControls();
  }

  /** The animation an automatic layout runs, and the slack that covers its final frames. */
  const LAYOUT_MS = 350;
  const DRIVE_SLACK_MS = 150;

  /** Move the viewport ourselves without that being mistaken for the viewer doing it. */
  function drive(fn, holdMs = DRIVE_SLACK_MS) {
    quietUntil = Math.max(quietUntil, Date.now() + holdMs);
    try { fn(); } finally { quietUntil = Math.max(quietUntil, Date.now() + holdMs); }
  }

  function refit() {
    if (!cy || !shown || !isAuto(shown)) return;
    drive(() => { cy.resize(); cy.fit(undefined, 20); });
  }

  function draw(id) {
    const v = visuals.get(id);
    if (!v || !ensureCy()) return;
    const auto = isAuto(id);
    const keep = auto ? null : { zoom: cy.zoom(), pan: { ...cy.pan() } };
    cy.elements().remove();
    cy.add([
      ...[...v.nodes.values()].map((n) => ({ group: "nodes", data: n })),
      ...v.edges.map((e) => ({ group: "edges", data: { id: `${e.source}->${e.target}`, ...e } })),
    ]);
    // A-path (design D4): relayout the whole graph animated, so we can see whether
    // a small demo graph jitters before committing to scoped B-path layout.
    drive(() => {
      cy.layout({ name: window.cytoscapeDagre ? "dagre" : "breadthfirst", animate: true, animationDuration: LAYOUT_MS, fit: auto, padding: 20 }).run();
      // A layout re-positions nodes even with `fit: false`, which shifts what the viewer's
      // scale was framing. Restoring their zoom/pan is what "the viewer wins" means in
      // practice: new content appears, the view does not jump.
      if (keep) { cy.zoom(keep.zoom); cy.pan(keep.pan); }
    }, LAYOUT_MS + DRIVE_SLACK_MS);
    updateControls();
  }

  // ---- the scale controls ----
  //
  // Three buttons, only in a box that actually holds a graph: zoom out, zoom in, and the
  // return to automatic fitting. The last one is the affordance the spec requires
  // explicitly — automatic fitting must never resume on its own, so there has to be
  // somewhere to ask for it.
  let controls = null;

  function ensureControls() {
    if (controls) return controls;
    controls = document.createElement("div");
    controls.className = "graph-controls";
    const btn = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "graph-btn";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    const zoom = (factor) => {
      if (!cy || !shown) return;
      setMode(shown, "manual");
      drive(() => cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: el.clientWidth / 2, y: el.clientHeight / 2 } }));
    };
    controls.appendChild(btn("−", "Kicsinyítés (kézi méret)", () => zoom(0.8)));
    controls.appendChild(btn("+", "Nagyítás (kézi méret)", () => zoom(1.25)));
    controls.appendChild(btn("⤢", "Vissza az automatikus illesztéshez", () => {
      if (!shown) return;
      setMode(shown, "auto");
      refit();
    }));
    el.appendChild(controls);
    return controls;
  }

  function updateControls() {
    const c = ensureControls();
    c.classList.toggle("manual", !!shown && !isAuto(shown));
  }

  return {
    apply(ev) {
      if (!ev.visual || !ev.graph) return;
      if (ev.graph.op === "reset" || !visuals.has(ev.visual)) {
        visuals.set(ev.visual, { nodes: new Map(), edges: [] });
        // A reset is a new topic: it starts fitted, never inheriting the previous scale.
        fitModes.set(ev.visual, "auto");
      }
      const v = visuals.get(ev.visual);
      for (const n of ev.graph.nodes ?? []) v.nodes.set(n.id, n);
      for (const e of ev.graph.edges ?? []) v.edges.push(e);
      if (ev.visual === shown) draw(shown); // live append to the shown visual
    },
    show(id) {
      if (id === shown || !visuals.has(id)) { if (visuals.has(id)) shown = id; return; }
      shown = id;
      el.classList.add("fade");
      draw(id);
      setTimeout(() => el.classList.remove("fade"), 400);
    },
    /** Called when the box's region changed size — re-fits only while automatic. */
    refit,
  };
}

// ---- chart renderer (dependency-free SVG, per the dataviz method) ----
//
// Horizontal bars for magnitude: labels read left-to-right (no rotated axis
// text, no overflow), one accent hue (single series needs no legend — the title
// names it), values direct-labeled in muted ink, bars baseline-anchored with
// 4px rounded ends. Replace-on-newer, like any `latest` slot.

const CHART = { w: 520, rowH: 30, barH: 16, labelW: 150, valueW: 52, pad: 14, titleH: 30, hue: "#4f8cff", ink: "#e7ecf5", muted: "#8aa0c0", track: "#22304a" };

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderBarChartSVG(spec) {
  const data = spec.data.filter((d) => d && typeof d.value === "number");
  const max = Math.max(1, ...data.map((d) => d.value));
  const { w, rowH, barH, labelW, valueW, pad, titleH, hue, ink, muted, track } = CHART;
  const plotX = labelW + pad;
  const plotW = w - plotX - valueW - pad;
  const h = titleH + data.length * rowH + pad;
  const unit = spec.unit ? ` ${esc(spec.unit)}` : "";

  const rows = data.map((d, i) => {
    const y = titleH + i * rowH;
    const cy = y + rowH / 2;
    const bw = Math.max(2, (d.value / max) * plotW);
    return `
      <text x="${labelW}" y="${cy}" text-anchor="end" dominant-baseline="central" fill="${ink}" font-size="13">${esc(d.label)}</text>
      <rect x="${plotX}" y="${cy - barH / 2}" width="${plotW}" height="${barH}" rx="4" fill="${track}"/>
      <rect x="${plotX}" y="${cy - barH / 2}" width="${bw}" height="${barH}" rx="4" fill="${hue}"/>
      <text x="${plotX + bw + 6}" y="${cy}" dominant-baseline="central" fill="${muted}" font-size="12">${esc(d.value)}${unit}</text>`;
  }).join("");

  const title = spec.title ? `<text x="${pad}" y="${titleH - 12}" fill="${ink}" font-size="14" font-weight="600">${esc(spec.title)}</text>` : "";
  // Fixed-height box (h px), full width, viewBox fit with meet → the chart keeps
  // its natural size centered, never stretching text or eating the graph's space.
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(spec.title || "chart")}">${title}${rows}</svg>`;
}

function makeChartSlot(el) {
  return {
    apply(ev) {
      if (!ev.chart || !Array.isArray(ev.chart.data)) return;
      el.innerHTML = renderBarChartSVG(ev.chart); // replace-on-newer
    },
  };
}

boot();
