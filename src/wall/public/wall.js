/**
 * The wall client. Vanilla ES module, no framework (design D3): SSE push in, one
 * slot DOM-mutation out — the whole page is never re-rendered. The only external
 * lib is Cytoscape, and only for `graph` slots; text slots are ~20-line renderers.
 */

import { gridTemplate, slotsForCategory } from "./wall-core.mjs";

const route = location.pathname;
const registry = new Map(); // category id → {render, icon, label}
const slotEls = new Map(); // area → { el, slot, render fns/state }

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
  const t = gridTemplate(win.slots);
  root.style.display = "grid";
  root.style.gridTemplateAreas = t.gridTemplateAreas;
  root.style.gridTemplateRows = t.gridTemplateRows;
  root.style.gridTemplateColumns = t.gridTemplateColumns;

  for (const slot of win.slots) {
    const el = document.createElement("div");
    el.className = `slot slot-${slot.behavior}${slot.pacing ? " slot-paced" : ""}`;
    el.style.gridArea = slot.area;
    el.dataset.area = slot.area;
    root.appendChild(el);
    // A slot's render harness follows its categories' render type: a Cytoscape
    // graph, an SVG chart, or plain DOM text lanes.
    const render = slot.cats.map((c) => registry.get(c)?.render).find(Boolean);
    slotEls.set(slot.area, {
      el, slot,
      graph: render === "graph" ? makeGraphSlot(el) : null,
      chart: render === "chart" ? makeChartSlot(el) : null,
    });
  }
}

function connect() {
  const es = new EventSource(`/events?route=${encodeURIComponent(route)}`);
  es.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.kind === "show") return onShow(msg);
    onEvent(msg);
  };
}

// ---- routing ----

function onEvent(ev) {
  const cat = registry.get(ev.category);
  if (!cat) return; // unknown category → drop, keep going
  for (const { slot, el, graph, chart } of slotEls.values()) {
    if (!slotsForCategory([slot], ev.category).length) continue;
    if (cat.render === "graph" && graph) graph.apply(ev);
    else if (cat.render === "chart" && chart) chart.apply(ev);
    else renderText(el, slot, cat, ev);
  }
}

function onShow(cmd) {
  for (const { slot, graph } of slotEls.values()) {
    if (graph && slot.cats.includes(cmd.cat)) graph.show(cmd.id);
  }
}

// ---- text renderers (scroll / latest) ----

function renderText(el, slot, cat, ev) {
  const line = document.createElement("div");
  line.className = "line";
  if (ev.speaker) line.classList.add(`speaker-${ev.speaker}`); // mic="én" vs system
  if (ev.priority === "immediate") line.classList.add("immediate");
  line.innerHTML = `<span class="icon">${cat.icon ?? ""}</span><span class="txt"></span>`;
  line.querySelector(".txt").textContent = ev.text ?? "";

  if (slot.behavior === "latest") {
    el.replaceChildren(line); // only the newest survives
  } else {
    el.appendChild(line); // scroll: accumulate…
    el.scrollTop = el.scrollHeight; // …and keep the newest in view
  }
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
