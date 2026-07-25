/**
 * The wall client. Vanilla ES module, no framework (design D3): SSE push in, one
 * slot DOM-mutation out — the whole page is never re-rendered. The only external
 * lib is Cytoscape, and only for `graph` slots; text slots are ~20-line renderers.
 */

import { gridTemplate, boxesForCategory, renderForEvent } from "./wall-core.mjs";

const route = location.pathname;
const registry = new Map(); // category id → {render, icon, label}
const boxEls = new Map(); // position → { el, box, lazily-built renderers }

async function boot() {
  const res = await fetch(`/api/bootstrap?route=${encodeURIComponent(route)}`);
  if (!res.ok) { document.body.textContent = `no window for ${route}`; return; }
  const { window: win, categories } = await res.json();
  for (const c of categories) registry.set(c.id, c);
  document.title = `set-copilot · ${win.name}`;
  mountGrid(win);
  connect();
}

function mountGrid(win) {
  const root = document.getElementById("wall");
  const t = gridTemplate(win.layout, win.boxes);
  root.style.display = "grid";
  root.style.gridTemplateAreas = t.gridTemplateAreas;
  root.style.gridTemplateRows = t.gridTemplateRows;
  root.style.gridTemplateColumns = t.gridTemplateColumns;

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
  const root = document.getElementById("wall");
  const boxes = [...boxEls.values()].map((e) => e.box);
  const t = gridTemplate(msg.layout, boxes);
  root.style.gridTemplateAreas = t.gridTemplateAreas;
  root.style.gridTemplateRows = t.gridTemplateRows;
  root.style.gridTemplateColumns = t.gridTemplateColumns;
  const positions = new Set(msg.layout.areas.flat().filter((c) => c && c !== "."));
  for (const entry of boxEls.values()) {
    entry.el.style.display = positions.has(entry.box.position) ? "" : "none";
  }
}

function connect() {
  const es = new EventSource(`/events?route=${encodeURIComponent(route)}`);
  es.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.kind === "show") return onShow(msg);
    if (msg.kind === "heartbeat") return onHeartbeat(msg);
    if (msg.kind === "pending") return onPending(msg);
    if (msg.kind === "stage-expired") return onStageExpired(msg);
    if (msg.kind === "layout") return onLayout(msg);
    onEvent(msg);
  };
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

function onHeartbeat(hb) {
  if (!statusEl) statusEl = document.getElementById("status-strip");
  if (!statusEl) return;
  statusEl.classList.remove("status-listening", "status-quiet", "status-dead");
  if (!hb.captureAlive) {
    statusEl.classList.add("status-dead");
    statusEl.textContent = "⚠ a capture leállt";
    return;
  }
  const age = hb.lastHeardMsAgo;
  if (age != null && age < QUIET_THRESHOLD_MS) {
    statusEl.classList.add("status-listening");
    statusEl.textContent = "🎙 figyelek";
  } else {
    statusEl.classList.add("status-quiet");
    statusEl.textContent = age == null ? "💤 csend" : `💤 csend · ${humanAge(age)} óta`;
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
  line.innerHTML = `<span class="time"></span><span class="icon">${cat.icon ?? ""}</span><span class="txt"></span>`;
  line.querySelector(".time").textContent = clock();
  line.querySelector(".txt").textContent = ev.text ?? "";

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

function makeGraphSlot(el) {
  const visuals = new Map(); // visual id → { nodes:Map, edges:[] }
  let shown = null;
  let cy = null;

  function ensureCy() {
    if (cy || typeof window.cytoscape !== "function") return cy;
    cy = window.cytoscape({
      container: el,
      style: [
        // width/height "label" + padding size the box to its text, so labels
        // like "transcript.jsonl" never overflow the box.
        { selector: "node", style: { label: "data(label)", "background-color": "#22304a", "border-color": "#4f8cff", "border-width": 1.5, color: "#e7ecf5", "font-size": 12, "text-valign": "center", "text-halign": "center", width: "label", height: "label", padding: "10px", shape: "round-rectangle", "text-wrap": "wrap", "text-max-width": "140px" } },
        { selector: "edge", style: { width: 2, "line-color": "#8aa0c0", "target-arrow-color": "#8aa0c0", "target-arrow-shape": "triangle", "curve-style": "bezier" } },
      ],
    });
    return cy;
  }

  function draw(id) {
    const v = visuals.get(id);
    if (!v || !ensureCy()) return;
    cy.elements().remove();
    cy.add([
      ...[...v.nodes.values()].map((n) => ({ group: "nodes", data: n })),
      ...v.edges.map((e) => ({ group: "edges", data: { id: `${e.source}->${e.target}`, ...e } })),
    ]);
    // A-path (design D4): relayout the whole graph animated, so we can see whether
    // a small demo graph jitters before committing to scoped B-path layout.
    cy.layout({ name: window.cytoscapeDagre ? "dagre" : "breadthfirst", animate: true, animationDuration: 350, fit: true, padding: 20 }).run();
  }

  return {
    apply(ev) {
      if (!ev.visual || !ev.graph) return;
      if (ev.graph.op === "reset" || !visuals.has(ev.visual)) visuals.set(ev.visual, { nodes: new Map(), edges: [] });
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
