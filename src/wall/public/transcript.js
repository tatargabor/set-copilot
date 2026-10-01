// The live transcript page (wall-transcript).
//
// Polls `/api/transcript` with a byte-offset cursor and appends what was said, grouped
// into turns: a new turn starts when the speaker changes or after a pause. Text is set
// with textContent only — a transcript is untrusted input.
(() => {
  "use strict";

  const POLL_MS = 1000;
  /** A pause longer than this starts a new turn even for the same speaker. */
  const TURN_GAP_MS = 12000;
  const COLORS = ["var(--sp-a)", "var(--sp-b)", "var(--sp-c)"];

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

  // ---- follow the live edge unless the reader scrolled up ----
  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.addEventListener("scroll", () => {
    follow = atBottom();
    jump.classList.toggle("show", !follow);
  });
  jump.onclick = () => { follow = true; jump.classList.remove("show"); log.scrollTop = log.scrollHeight; };

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
    log.appendChild(el);
    turn = { speaker: line.speaker, said, lastTs: line.ts };
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
  };

  const reset = () => {
    for (const el of [...log.querySelectorAll(".turn")]) el.remove();
    if (!empty.parentNode) log.appendChild(empty);
    turn = null;
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
      if (!data.id) {
        setStatus(false, "waiting for the capture");
      } else {
        if (data.id !== fileId) { reset(); fileId = data.id; }
        for (const line of data.lines) add(line);
        offset = data.offset;
        setStatus(true, "live");
        if (follow && data.lines.length) log.scrollTop = log.scrollHeight;
      }
    } catch (e) {
      setStatus(false, "reconnecting…");
    }
    setTimeout(poll, POLL_MS);
  }

  poll();
})();
