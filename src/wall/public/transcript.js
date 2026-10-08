// The live transcript page (wall-transcript).
//
// Polls `/api/transcript` with a byte-offset cursor and shows what was said, grouped
// into turns: a new turn starts when the speaker changes or after a pause. Text is set
// with textContent only — a transcript is untrusted input.
//
// The server also sends the wall's theme (`studio-dark` gets the matching palette) and
// the reading order: `oldest-first` appends at the bottom and follows the live edge,
// `newest-first` puts the latest turn at the top and follows the top instead.
(() => {
  "use strict";

  const POLL_MS = 1000;
  /** A pause longer than this starts a new turn even for the same speaker. */
  const TURN_GAP_MS = 12000;
  const COLORS = ["var(--sp-a)", "var(--sp-b)", "var(--sp-c)"];
  /** DOM budget: once this many fragments are shown, the oldest turns are dropped so a
   *  page left open for days does not grow without bound. */
  const MAX_PIECES = 5000;

  const log = document.getElementById("log");
  const empty = document.getElementById("empty");
  const jump = document.getElementById("jump");
  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const legend = document.getElementById("legend");

  let fileId = null;
  let offset = 0;
  let turn = null; // { speaker, said, stamp, lastTs }
  const colorOf = new Map();
  let follow = true;
  let newestFirst = false;
  /** Turns in arrival order, with how many fragments each holds (for the DOM budget). */
  const turns = [];
  let pieces = 0;

  // ---- text size, remembered per viewer ----
  let size = 20;
  try { size = Number(localStorage.getItem("transcript-size")) || 20; } catch (_) { /* storage blocked */ }
  const applySize = () => {
    document.documentElement.style.setProperty("--size", `${size}px`);
    try { localStorage.setItem("transcript-size", String(size)); } catch (_) { /* storage blocked */ }
  };
  applySize();
  document.getElementById("smaller").onclick = () => { size = Math.max(14, size - 2); applySize(); };
  document.getElementById("larger").onclick = () => { size = Math.min(40, size + 2); applySize(); };

  // ---- follow the live edge (bottom, or top when newest-first) unless the reader scrolled away ----
  const atEdge = () => newestFirst
    ? log.scrollTop < 60
    : log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const toEdge = () => { log.scrollTop = newestFirst ? 0 : log.scrollHeight; };
  log.addEventListener("scroll", () => {
    follow = atEdge();
    jump.classList.toggle("show", !follow);
  });
  jump.onclick = () => { follow = true; jump.classList.remove("show"); toEdge(); };

  const applyView = (data) => {
    const theme = data.theme || "default";
    if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
    const nf = data.order === "newest-first";
    if (nf !== newestFirst) {
      newestFirst = nf;
      jump.textContent = newestFirst ? "↑ Live" : "↓ Live";
      return true; // the order changed: rebuild from the start
    }
    return false;
  };

  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  const colorFor = (speaker, label) => {
    if (!colorOf.has(speaker)) {
      const c = COLORS[colorOf.size % COLORS.length];
      colorOf.set(speaker, c);
      const chip = document.createElement("span");
      chip.style.setProperty("--c", c);
      chip.textContent = label;
      legend.appendChild(chip);
    }
    return colorOf.get(speaker);
  };

  const startTurn = (line) => {
    const el = document.createElement("div");
    el.className = "turn";
    el.style.setProperty("--c", colorFor(line.speaker, line.label));
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = line.label || line.speaker || "—";
    const stamp = document.createElement("small");
    stamp.textContent = clock(line.ts);
    who.appendChild(stamp);
    const said = document.createElement("p");
    said.className = "said";
    el.append(who, said);
    if (newestFirst) log.insertBefore(el, log.firstChild);
    else log.appendChild(el);
    turn = { speaker: line.speaker, said, lastTs: line.ts, el, pieces: 0 };
    turns.push(turn);
  };

  const add = (line) => {
    if (!line.text) return;
    if (empty.parentNode) empty.remove();
    const newTurn = !turn || turn.speaker !== line.speaker || (line.ts - turn.lastTs > TURN_GAP_MS && !line.cont);
    if (newTurn) startTurn(line);
    const piece = document.createElement("span");
    piece.className = "fresh";
    // A fragment cut mid-word joins without a space; anything else is a new word.
    const lead = !newTurn && !line.midWord && !/^[,.;:!?)]/.test(line.text) ? " " : "";
    piece.textContent = lead + line.text.replace(/^\s+/, "");
    turn.said.appendChild(piece);
    turn.lastTs = line.ts;
    turn.pieces++;
    pieces++;
    // Drop the oldest turns once over budget — never the one being written to.
    while (pieces > MAX_PIECES && turns.length > 1) {
      const old = turns.shift();
      old.el.remove();
      pieces -= old.pieces;
    }
  };

  const reset = () => {
    for (const el of [...log.querySelectorAll(".turn")]) el.remove();
    if (!empty.parentNode) log.appendChild(empty);
    turn = null;
    turns.length = 0;
    pieces = 0;
    offset = 0;
  };

  const setStatus = (live, text) => {
    statusEl.classList.toggle("live", live);
    statusText.textContent = text;
  };

  async function poll() {
    try {
      const q = new URLSearchParams({ offset: String(offset) });
      if (fileId) q.set("id", fileId);
      const r = await fetch(`/api/transcript?${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data.title) {
        document.getElementById("title").textContent = data.title;
        document.title = data.title;
      }
      if (applyView(data)) {
        // The order switched: this response was cut from a cursor built in the other
        // order, so drop it and read the transcript again from the start.
        reset(); fileId = null; follow = true;
        setTimeout(poll, 0);
        return;
      }
      if (!data.id) {
        setStatus(false, "waiting for the capture");
      } else {
        // A new file: the server already ignored our stale cursor and read from its start.
        if (data.id !== fileId) { reset(); fileId = data.id; }
        for (const line of data.lines) add(line);
        offset = data.offset;
        setStatus(true, "live");
        if (follow && data.lines.length) toEdge();
      }
    } catch (e) {
      setStatus(false, "reconnecting…");
    }
    setTimeout(poll, POLL_MS);
  }

  poll();
})();
