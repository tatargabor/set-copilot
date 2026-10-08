/**
 * The wall client. Vanilla ES module, no framework (design D3): SSE push in, one
 * slot DOM-mutation out — the whole page is never re-rendered. The only external
 * lib is Cytoscape, and only for `graph` slots; text slots are ~20-line renderers.
 */

import {
  gridTemplate, boxesForCategory, renderForEvent, connectionState, applyViewportOverride,
  dragPairShares, stripState,
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

// ---- presentation (wall-presentation) ----
//
// Chrome only: the title bar, the language of the wall's OWN labels, the input box's
// presence, the theme and the type scale. It never touches content — what reaches the
// wall is still decided by zones and the server-side redactor, nothing here.
let presentation = { locale: "hu", hideInput: false, theme: "default", scale: 1 };

const STRINGS = {
  hu: {
    me: "én", others: "mások", reset: "⤢ arányok alaphelyzetbe", placeholder: "Üzenet a copilotnak…",
    send: "Küldés", sent: "✓ elküldve", failed: "✗ nem sikerült", ago: "óta", sec: "mp", min: "perc",
    chan: { active: "beszél", quiet: "csendben", absent: "nincs csatorna", stopped: "leállt", unknown: "nem tudni" },
    conn: null, // connectionState's own (Hungarian) labels
  },
  en: {
    me: "us", others: "them", reset: "⤢ reset layout", placeholder: "Message to the copilot…",
    send: "Send", sent: "✓ sent", failed: "✗ failed", ago: "ago", sec: "s", min: "min",
    chan: { active: "speaking", quiet: "quiet", absent: "no channel", stopped: "stopped", unknown: "unknown" },
    conn: { listening: "● Live", quiet: "● Live · listening", dead: "⚠ Capture stopped", disconnected: "⛔ Reconnecting…" },
  },
};
const tr = () => STRINGS[presentation.locale] ?? STRINGS.hu;

function applyPresentation(p) {
  presentation = { ...presentation, ...(p ?? {}) };
  const root = document.documentElement;
  root.lang = presentation.locale;
  // `studio-dark` is the studio layout with its own palette: every studio rule applies,
  // and the `data-variant="dark"` overrides in wall.css swap the colours.
  const dark = presentation.theme === "studio-dark";
  root.dataset.theme = dark ? "studio" : presentation.theme;
  if (dark) root.dataset.variant = "dark";
  else delete root.dataset.variant;
  root.style.setProperty("--scale", String(presentation.scale ?? 1));
  let bar = document.getElementById("title-bar");
  if (presentation.title) {
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "title-bar";
      bar.className = "title-bar";
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.replaceChildren();
    const mark = document.createElement("span");
    mark.className = "title-mark";
    mark.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "title-text";
    title.textContent = presentation.title;
    bar.append(mark, title);
    if (presentation.subtitle) {
      const sub = document.createElement("span");
      sub.className = "title-sub";
      sub.textContent = presentation.subtitle;
      bar.appendChild(sub);
    }
  } else if (bar) {
    bar.remove();
  }
  stripParts = null; // labels and the input box depend on the presentation: rebuild the strip
}

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
  applyPresentation(payload.presentation);
  document.title = presentation.title ?? `set-copilot · ${payload.window.name}`;
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
    const boxTitle = presentation.boxTitles?.[box.position];
    if (boxTitle) el.dataset.title = boxTitle;
    root.appendChild(el);
    // Renderers are built on first use, not from the box's subscriptions: a
    // presentation box may hold a graph now and a chart next, and which one it
    // gets is not knowable at mount time.
    boxEls.set(box.position, { el, box, graph: null, chart: null, panes: new Map(), shown: null, shownAt: 0, pending: null });
    // Reference boxes (agenda, pinned record) hold a block, not a stream: when it overflows,
    // it scrolls itself so nobody has to reach for the shared screen.
    if (box.behavior === "latest" && !box.pacing && !presentation.tickers?.[box.position]) {
      attachAutoScroll(el, box.position);
    }
    if (box.pacing) attachMaximize(el);
  }
  // After the boxes exist: a row with no declared size takes it from the box occupying it,
  // so the template can only be derived once they are known.
  applyGrid();
  // replaceChildren() removed the handles with everything else; forget the remembered
  // shape so syncHandles rebuilds them even when the layout did not change.
  handlesShape = null;
  syncHandles(root);
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
  syncHandles(document.getElementById("wall"));
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

/**
 * The override an active drag is building, applied by applyGrid WITHOUT touching storage:
 * it is written to localStorage once, on release (wall-splitter-and-drag-fixes). Two
 * synchronous storage ops per mousemove bought nothing.
 */
let liveOverride = null;

/** The shape (layout id + track counts) the current handle set was built for. */
let handlesShape = null;

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
 * Derive the grid template, apply this viewer's override, paint it.
 *
 * The single place the grid is written. Mount, a runtime layout switch, a drag and a reset
 * all funnel through here, so there is exactly one description of what geometry the window
 * has — the failure mode otherwise is a drag that survives a layout switch on one path and
 * not another. It deliberately does NOT touch the handles: they are grid items and move
 * with the tracks on their own, and rebuilding them here used to destroy the element under
 * the pointer on every mousemove of a drag (wall-splitter-and-drag-fixes).
 */
function applyGrid() {
  const root = document.getElementById("wall");
  if (!root || !currentLayout) return;
  const boxes = [...boxEls.values()].map((e) => e.box);
  const base = gridTemplate(currentLayout, boxes);
  const o = liveOverride ?? readOverride(currentLayout.id);
  const t = applyViewportOverride(base, o, currentLayout.id);
  root.style.gridTemplateAreas = t.gridTemplateAreas;
  root.style.gridTemplateRows = t.gridTemplateRows;
  root.style.gridTemplateColumns = t.gridTemplateColumns;
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
 * pulled over the gap by a negative margin (see wall.css for the arithmetic — the sign
 * there is what centers the visible bar on the gap). That is what keeps the handles out of
 * the layout arithmetic entirely: they occupy no track of their own, and as grid items
 * they MOVE WITH THE TRACKS — which is why nothing here needs to run again while a drag
 * only changes sizes.
 */
function buildHandles(root) {
  for (const old of [...root.querySelectorAll(".splitter")]) old.remove();
  const cols = currentLayout.areas[0]?.length ?? 1;
  const rows = currentLayout.areas.length;

  for (let i = 0; i < cols - 1; i++) root.appendChild(makeHandle("columns", i, rows, cols));
  for (let i = 0; i < rows - 1; i++) root.appendChild(makeHandle("rows", i, rows, cols));
}

/**
 * Rebuild the handles only when the grid's SHAPE changed.
 *
 * Handles depend on the track counts, never on the track sizes, so a drag — which changes
 * only sizes — has no reason to come through here. Callers are the two things that change
 * the shape: a mount and a runtime layout switch. mountGrid resets `handlesShape` because
 * replaceChildren() removes the handles along with everything else, even when the layout
 * id and counts come back identical.
 */
function syncHandles(root) {
  if (!root || !currentLayout) return;
  const cols = currentLayout.areas[0]?.length ?? 1;
  const rows = currentLayout.areas.length;
  const shape = `${currentLayout.id}:${cols}x${rows}`;
  if (shape === handlesShape) return;
  handlesShape = shape;
  buildHandles(root);
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
  const totalPx = sizes.reduce((a, b) => a + b, 0);
  // The whole gesture is measured against the layout it started on; if a runtime layout
  // switch or a reconnect-bootstrap lands under the pointer, the drag is discarded — a px
  // measurement against tracks that no longer exist must never be persisted (and the
  // track-count check inside applyViewportOverride alone would miss the case where the
  // counts coincidentally match).
  const dragLayoutId = currentLayout.id;
  const o = readOverride(dragLayoutId) ?? { layoutId: dragLayoutId };
  o.layoutId = dragLayoutId;
  // Only one form can hold an axis. A whole-axis override stays whole-axis when any
  // boundary on that axis is dragged again (the newer gesture wins, measured px baked to
  // shares); a pair override is refined by the SAME boundary and degraded to whole-axis
  // shares by a DIFFERENT one — proportions that boundary's drag cannot express.
  if (o[axis] && !Array.isArray(o[axis]) && !(o[axis].pair && o[axis].pair.index === index)) {
    o[axis] = sizes.map((px) => px / totalPx);
  }
  liveOverride = o;
  ev.target.setPointerCapture?.(ev.pointerId);
  ev.preventDefault();
  document.body.classList.add(axis === "columns" ? "dragging-col" : "dragging-row");

  const cancel = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    liveOverride = null;
    document.body.classList.remove("dragging-col", "dragging-row");
  };
  const move = (m) => {
    if (!currentLayout || currentLayout.id !== dragLayoutId) return cancel();
    const delta = (axis === "columns" ? m.clientX : m.clientY) - startPos;
    if (o[axis] && !Array.isArray(o[axis])) {
      // Pair mode: the dragged boundary moves alone, untouched tracks stay verbatim.
      // Push px through the pure function: it normalises to shares and keeps each side at
      // or above the floor, so a drag past a region's floor stops there instead of
      // collapsing it — and no other boundary moves to pay for it.
      const p = dragPairShares(totalPx, sizes[index], sizes[index + 1], delta);
      if (p) o[axis] = { pair: { index, a: p.a, b: p.b } };
    } else {
      // Whole-axis mode: normalise the measured px to shares; applyViewportOverride clamps.
      if (!(totalPx > 0)) return;
      const next = sizes.slice();
      next[index] = sizes[index] + delta;
      next[index + 1] = sizes[index + 1] - delta;
      o[axis] = next.map((px) => px / totalPx);
    }
    applyGrid();
  };
  const up = () => {
    cancel();
    writeOverride(o);
    updateResetAffordance();
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
    // The box's own chrome (full-screen and auto-scroll toggles) is not content: keep it.
    entry.el.replaceChildren(...entry.el.querySelectorAll(":scope > .maximize-toggle, :scope > .autoscroll-toggle"));
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
  if (s < 60) return `${s} ${tr().sec}`;
  const m = Math.round(s / 60);
  return `${m} ${tr().min}`;
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

const CHANNEL_ICONS = { mic: "🎙", system: "🔊" };
const channelName = (key) => (key === "mic" ? tr().me : tr().others);

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
    icon.textContent = CHANNEL_ICONS[key];
    const bar = document.createElement("span");
    bar.className = "chan-bar";
    const name = document.createElement("span");
    name.className = "chan-name";
    name.textContent = channelName(key);
    c.append(icon, name, bar);
    group.appendChild(c);
    chans[key] = c;
  }
  statusEl.appendChild(group);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.id = "viewport-reset";
  reset.className = "viewport-reset";
  reset.textContent = tr().reset;
  reset.hidden = true;
  reset.addEventListener("click", resetViewport);
  statusEl.appendChild(reset);

  // The operator's keyboard into the session (wall-input): the strip is the one piece of
  // furniture guaranteed in every layout, same reasoning as the reset button above.
  if (!presentation.hideInput) {
  const form = document.createElement("form");
  form.id = "wall-input";
  form.className = "wall-input";
  form.autocomplete = "off";
  const msg = document.createElement("input");
  msg.type = "text";
  msg.maxLength = 400;
  msg.placeholder = tr().placeholder;
  msg.setAttribute("aria-label", tr().placeholder);
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = tr().send;
  form.append(msg, send);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    sendWallInput(msg);
  });
  statusEl.appendChild(form);
  }

  stripParts = { label, chans };
  updateResetAffordance();
  return stripParts;
}

/**
 * A one-shot note on the strip — the least-mechanism echo of a wall-input send.
 *
 * Deliberately NOT a display event: echoing the operator's text into the wall's text
 * stream would fake a copilot emission and lie about who said it. The confirmation says
 * the send happened; nothing more.
 */
let stripNoteTimer = null;
function flashStripNote(text) {
  if (!statusEl) return;
  let note = statusEl.querySelector(".wall-input-note");
  if (!note) {
    note = document.createElement("span");
    note.className = "wall-input-note";
    statusEl.appendChild(note);
  }
  note.textContent = text;
  clearTimeout(stripNoteTimer);
  stripNoteTimer = setTimeout(() => note.remove(), 2000);
}

async function sendWallInput(msg) {
  const text = msg.value;
  // A drag owns the pointer and the operator's attention; a send mid-drag is a mis-click.
  if (!text.trim() || document.body.classList.contains("dragging-col") || document.body.classList.contains("dragging-row")) return;
  try {
    const res = await fetch("/api/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route, text }),
    });
    if (res.status === 204) {
      msg.value = "";
      flashStripNote(tr().sent);
      return;
    }
    flashStripNote(tr().failed);
  } catch {
    flashStripNote(tr().failed);
  }
}

const channelStateText = (state) => tr().chan[state] ?? state;

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
  const label = tr().conn?.[st.state] ?? st.label;
  parts.label.textContent = st.state === "quiet" && age != null
    ? `${label} · ${humanAge(age)} ${tr().ago}`
    : label;

  // Per-channel indicators (D6): a shape and a colour, not a sentence — the strip is read
  // at wall distance, where "which channel is live" has to survive not being read at all.
  const chans = stripState(lastHb, { quietThresholdMs: QUIET_THRESHOLD_MS, connection: st.state });
  for (const key of ["mic", "system"]) {
    const el = parts.chans[key];
    const s = chans[key];
    el.className = `chan chan-${key} chan-${s.state}`;
    const name = channelName(key);
    el.title = s.msAgo != null && s.state === "quiet"
      ? `${name}: ${channelStateText(s.state)} (${humanAge(s.msAgo)} ${tr().ago})`
      : `${name}: ${channelStateText(s.state)}`;
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
    const pane = paneFor(entry, "text");
    renderText(pane, entry.box, cat, ev);
    const tickerMode = presentation.tickers?.[entry.box.position];
    if (tickerMode) decorateTicker(pane, tickerMode);
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

// ---- full-screen canvas (wall-presentation) ----
//
// The canvas can take the whole wall when a drawing is the only thing worth looking at, and
// hand the space back just as easily: a button in its corner, F to toggle, Esc to return.
// Viewer-side only — the other boxes keep receiving content underneath.
let maximizedEl = null;

function setMaximized(el, on) {
  if (maximizedEl && maximizedEl !== el) maximizedEl.classList.remove("slot-maximized");
  el.classList.toggle("slot-maximized", on);
  maximizedEl = on ? el : null;
  const btn = el.querySelector(".maximize-toggle");
  if (btn) {
    btn.textContent = on ? "✕ Back" : "⛶ Full screen";
    btn.title = on ? "Back to the planning view (Esc)" : "Show the canvas full screen (F)";
  }
}

function attachMaximize(el) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "maximize-toggle";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setMaximized(el, !el.classList.contains("slot-maximized"));
  });
  el.appendChild(btn);
  setMaximized(el, false);
}

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Escape" && maximizedEl) setMaximized(maximizedEl, false);
  else if (e.key === "f" || e.key === "F") {
    const canvas = maximizedEl ?? document.querySelector(".slot-paced");
    if (canvas) setMaximized(canvas, !canvas.classList.contains("slot-maximized"));
  }
});

// ---- auto-scroll (wall-presentation) ----
//
// Ping-pong: rest at the top, glide down, rest at the bottom, glide back. It only moves a
// box whose content is taller than the box, it stops while the pointer is over the box (the
// viewer is reading), and every box gets its own on/off toggle, remembered per viewer.
// Default comes from `presentation.autoScroll` (on unless a project turns it off).
const AUTO_SCROLL_PX_S = 22;
const AUTO_SCROLL_REST_MS = 3500;

function attachAutoScroll(el, key) {
  const storeKey = `set-copilot:autoscroll:${route}:${key}`;
  let on = presentation.autoScroll !== false;
  try {
    const saved = localStorage.getItem(storeKey);
    if (saved != null) on = saved === "1";
  } catch { /* storage unavailable — the default stands */ }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "autoscroll-toggle";
  const paint = () => {
    btn.classList.toggle("on", on);
    btn.textContent = on ? "⇅ auto" : "⇅ off";
    btn.title = on ? "Auto-scroll on — click to stop" : "Auto-scroll off — click to start";
  };
  paint();
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    on = !on;
    try { localStorage.setItem(storeKey, on ? "1" : "0"); } catch { /* not fatal */ }
    restUntil = performance.now() + 600;
    pos = el.scrollTop;
    paint();
  });
  el.appendChild(btn);

  let dir = 1;
  let pos = 0;
  let hovering = false;
  let restUntil = performance.now() + AUTO_SCROLL_REST_MS;
  let last = performance.now();
  el.addEventListener("mouseenter", () => { hovering = true; });
  el.addEventListener("mouseleave", () => {
    hovering = false;
    pos = el.scrollTop;
    restUntil = performance.now() + AUTO_SCROLL_REST_MS;
  });

  function tick(now) {
    if (!el.isConnected) return; // the grid was remounted — this box is gone
    const dt = Math.min(now - last, 100);
    last = now;
    const max = el.scrollHeight - el.clientHeight;
    const overflowing = max > 4;
    btn.hidden = !overflowing;
    if (on && overflowing && !hovering && now >= restUntil) {
      pos = Math.min(max, Math.max(0, pos + dir * AUTO_SCROLL_PX_S * (dt / 1000)));
      if (pos >= max) { dir = -1; restUntil = now + AUTO_SCROLL_REST_MS; }
      else if (pos <= 0) { dir = 1; restUntil = now + AUTO_SCROLL_REST_MS; }
      el.scrollTop = pos;
    } else if (!on || hovering) {
      pos = el.scrollTop;
    }
    // Keep the toggle pinned to the box's visible corner while its content moves.
    btn.style.transform = `translateY(${el.scrollTop}px)`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---- ticker bands (wall-presentation) ----
//
// A box named in `presentation.tickers` shows its latest text as a band instead of a
// block: each list item (or paragraph) becomes one ticker item. `marquee` scrolls them
// continuously; `rotate` shows one at a time and cross-fades to the next. The content is
// still an ordinary `latest` text event — the band is only how this viewer displays it,
// so redaction and zones apply exactly as for any other box.
const TICKER_SPEED_PX_S = 70;
const ROTATE_MS = 6000;

function decorateTicker(pane, mode) {
  clearInterval(pane._tickerTimer);
  const items = [...pane.querySelectorAll(".txt li, .txt .p, .txt .hd")]
    .filter((n) => !n.querySelector("li") && n.textContent.trim());
  if (!items.length) return;
  const view = document.createElement("div");
  view.className = `ticker-view ticker-${mode}`;
  // Items are copies of the nodes the text renderer already built — never re-parsed markup.
  const makeItem = (src) => {
    const it = document.createElement("span");
    it.className = "ticker-item";
    for (const child of src.childNodes) it.appendChild(child.cloneNode(true));
    return it;
  };
  if (mode === "rotate") {
    const rotor = items.map(makeItem);
    rotor.forEach((it, i) => it.classList.toggle("on", i === 0));
    view.append(...rotor);
    let i = 0;
    if (rotor.length > 1) {
      pane._tickerTimer = setInterval(() => {
        rotor[i].classList.remove("on");
        i = (i + 1) % rotor.length;
        rotor[i].classList.add("on");
      }, ROTATE_MS);
    }
  } else {
    // Two copies of the run, scrolled by exactly one copy's width: a seamless loop.
    const track = document.createElement("div");
    track.className = "ticker-track";
    for (let copy = 0; copy < 2; copy++) for (const src of items) track.appendChild(makeItem(src));
    view.appendChild(track);
    requestAnimationFrame(() => {
      const half = track.scrollWidth / 2;
      track.style.setProperty("--ticker-duration", `${Math.max(12, half / TICKER_SPEED_PX_S)}s`);
    });
  }
  pane.replaceChildren(view);
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
let activeGraphKeys = null;
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  activeGraphKeys?.(e.key);
});

function makeGraphSlot(el) {
  const visuals = new Map(); // visual id → { nodes:Map, edges:[] }
  // Tabs (wall-presentation): every visual this box has received, in arrival order. By
  // default the box FOLLOWS the server's pick (the director's show command); a click or
  // ←/→ takes manual control, and "Auto" (or A) hands it back.
  const order = [];
  const titles = new Map();
  let follow = true;
  let serverPick = null;
  let tabsEl = null;
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
  let userGestureAt = 0;
  let lastDrawn = null;

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
      node: v("--graph-node", v("--line", "#22304a")),
      border: v("--accent", "#4f8cff"),
      ink: v("--text", "#e7ecf5"),
      edge: v("--muted", "#8aa0c0"),
      // Node tones (wall-presentation): a node may carry `tone` to say which side it
      // belongs to — e.g. who builds a work package — without a per-node colour.
      primary: v("--tone-primary", "#4f8cff"),
      secondary: v("--tone-secondary", "#35c7a5"),
      shared: v("--tone-shared", "#c08cff"),
      open: v("--tone-open", "#e0b04f"),
      done: v("--ok", "#4fd08a"),
      group: v("--graph-group", "#141a28"),
    };
  }

  function graphStyle() {
    const c = palette();
    return [
      // width/height "label" + padding size the box to its text, so labels
      // like "transcript.jsonl" never overflow the box.
      { selector: "node", style: { label: "data(label)", "background-color": c.node, "border-color": c.border, "border-width": 1.5, color: c.ink, "font-size": 13, "text-valign": "center", "text-halign": "center", width: "label", height: "label", padding: "9px", shape: "round-rectangle", "text-wrap": "wrap", "text-max-width": "140px" } },
      { selector: "edge", style: { width: 2, "line-color": c.edge, "target-arrow-color": c.edge, "target-arrow-shape": "triangle", "curve-style": "bezier" } },
      // A layout-only edge (`invisible: true`) shapes the arrangement — e.g. stacks a group's
      // members into a column — without drawing anything.
      { selector: "edge[?invisible]", style: { opacity: 0, "target-arrow-shape": "none" } },
      { selector: "edge[label]", style: { label: "data(label)", "font-size": 10, color: c.edge, "text-background-color": c.group, "text-background-opacity": 1, "text-background-padding": "2px" } },
      // A node with `parent` sits inside a group box (Cytoscape compound nodes).
      { selector: ":parent", style: { "background-color": c.group, "background-opacity": 0.6, "border-color": c.edge, "border-width": 1, "border-style": "dashed", "text-valign": "top", "text-halign": "center", "font-size": 12, "font-weight": 600, color: c.ink, padding: "14px", shape: "round-rectangle" } },
      { selector: "node[image]", style: { label: "", shape: "rectangle", "background-image": "data(image)", "background-fit": "contain", "background-opacity": 0, "border-width": 0, width: "data(w)", height: "data(h)", padding: "0px" } },
      { selector: 'node[tone = "primary"]', style: { "border-color": c.primary, "border-width": 2, "background-color": c.primary, "background-opacity": 0.22 } },
      { selector: 'node[tone = "secondary"]', style: { "border-color": c.secondary, "border-width": 2, "background-color": c.secondary, "background-opacity": 0.22 } },
      { selector: 'node[tone = "shared"]', style: { "border-color": c.shared, "border-width": 2, "background-color": c.shared, "background-opacity": 0.22 } },
      { selector: 'node[tone = "open"]', style: { "border-color": c.open, "border-width": 2, "border-style": "dashed", "background-color": c.open, "background-opacity": 0.12 } },
      { selector: 'node[tone = "done"]', style: { "border-color": c.done, "border-width": 2, "background-color": c.done, "background-opacity": 0.2 } },
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
    // Only a real gesture counts: a zoom/pan within a moment of the viewer's own wheel or
    // pointer input. Timing alone (quietUntil) misread the tail of long animated layouts as
    // the viewer taking control, leaving a freshly drawn graph small and un-fitted.
    el.addEventListener("wheel", () => { userGestureAt = Date.now(); }, { passive: true, capture: true });
    el.addEventListener("pointerdown", () => { userGestureAt = Date.now(); }, { capture: true });
    cy.on("zoom pan", () => {
      if (Date.now() >= quietUntil && Date.now() - userGestureAt < 1500 && shown) setMode(shown, "manual");
    });
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
    // A node carrying numeric `x`/`y` is placed exactly (preset layout): a board or a
    // matrix — e.g. work packages in ordered columns — needs positions, not a flow layout.
    const at = (n) => (typeof n.x === "number" && typeof n.y === "number" ? { position: { x: n.x, y: n.y } } : {});
    // A node carrying `image` is a picture — e.g. a figure from a client document shown as
    // it is. A local path goes through /media, which confines it server-side, exactly as
    // an image event does; the node then gets the tabs, follow and full-screen of any graph.
    const media = (n) => (typeof n.image === "string" && n.image
      ? { ...n, image: isHttp(n.image) ? n.image : `/media?src=${encodeURIComponent(n.image)}` }
      : n);
    const placed = [...v.nodes.values()].some((n) => at(n).position);
    cy.add([
      ...[...v.nodes.values()].map((n) => ({ group: "nodes", data: media(n), ...at(n) })),
      ...v.edges.map((e) => ({ group: "edges", data: { id: `${e.source}->${e.target}`, ...e } })),
    ]);
    // A-path (design D4): relayout the whole graph animated, so we can see whether
    // a small demo graph jitters before committing to scoped B-path layout.
    drive(() => {
      if (placed) {
        // Positions are given: nothing to animate, and fitting at once means the first
        // frame the audience sees is already the whole board.
        cy.layout({ name: "preset", animate: false, fit: auto, padding: 24 }).run();
        if (auto) cy.fit(undefined, 24);
      } else {
        // A visual appearing for the first time is laid out in place — animating it from a
        // pile at the origin reads as a glitch on a shared screen. Growth of the visual
        // already on screen still animates, which is where motion carries meaning.
        const fresh = lastDrawn !== id;
        // Flow direction follows the box: a wide canvas reads left-to-right, a tall one
        // top-down — otherwise a flow drawn against the grain is fitted down to a sliver.
        const rankDir = el.clientWidth / Math.max(1, el.clientHeight) > 1.6 ? "LR" : "TB";
        cy.layout({ name: window.cytoscapeDagre ? "dagre" : "breadthfirst", rankDir, nodeSep: 24, rankSep: 56, animate: !fresh, animationDuration: LAYOUT_MS, fit: auto, padding: 20 }).run();
        if (fresh && auto) cy.fit(undefined, 20);
      }
      lastDrawn = id;
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

  function showVisual(id) {
    if (id === shown || !visuals.has(id)) { if (visuals.has(id)) shown = id; renderTabs(); return; }
    shown = id;
    el.classList.add("fade");
    draw(id);
    setTimeout(() => el.classList.remove("fade"), 400);
    renderTabs();
  }

  function pick(id) {
    follow = false;
    showVisual(id);
  }

  function resumeFollow() {
    follow = true;
    if (serverPick) showVisual(serverPick);
    else renderTabs();
  }

  function step(delta) {
    if (!order.length) return;
    const i = Math.max(0, order.indexOf(shown));
    pick(order[(i + delta + order.length) % order.length]);
  }

  function renderTabs() {
    if (order.length < 2) { tabsEl?.remove(); tabsEl = null; return; }
    if (!tabsEl) {
      tabsEl = document.createElement("div");
      tabsEl.className = "graph-tabs";
      el.appendChild(tabsEl);
    }
    tabsEl.replaceChildren();
    const chip = (label, cls, onClick, title) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `graph-tab ${cls}`;
      b.textContent = label;
      if (title) b.title = title;
      b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
      tabsEl.appendChild(b);
    };
    chip("Auto", follow ? "graph-tab-auto on" : "graph-tab-auto", resumeFollow, "Follow the conversation (A)");
    for (const id of order) {
      const cls = [id === shown ? "on" : "", !follow && id === serverPick && id !== shown ? "fresh" : ""].join(" ");
      chip(titles.get(id) ?? id, cls, () => pick(id), "Show this visual (← →)");
    }
  }

  // One keyboard owner: the most recently created graph box. ←/→ page, A resumes following.
  activeGraphKeys = (key) => {
    if (key === "ArrowRight") step(1);
    else if (key === "ArrowLeft") step(-1);
    else if (key === "a" || key === "A") resumeFollow();
  };

  function updateControls() {
    const c = ensureControls();
    c.classList.toggle("manual", !!shown && !isAuto(shown));
  }

  return {
    apply(ev) {
      if (!ev.visual || !ev.graph) return;
      if (!titles.has(ev.visual)) order.push(ev.visual);
      titles.set(ev.visual, ev.title || titles.get(ev.visual) || ev.visual);
      renderTabs();
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
    /** The server's pick. Obeyed while following; otherwise only marked on its tab. */
    show(id) {
      serverPick = id;
      if (follow) showVisual(id);
      else renderTabs();
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
