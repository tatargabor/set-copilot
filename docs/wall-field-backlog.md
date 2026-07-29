# Wall + meeting-copilot — field backlog

Prioritized backlog distilled from **real-world use of set-copilot** in the `consumer-c`
project (Claude Code session transcripts, 2026-07, ~4 live meetings + dictation sessions).
Each item is a candidate `/opsx:propose` change. Ordered by impact × how often it bit.

The learnings that reshaped the `wall-chat-mirror` change (hook enforcement, `chat-wide`
rename, no dead region) are already folded into that change and are **not** repeated here.

## P0 — breaks the live demo

> **Also P0, filed separately with full evidence and an acceptance list:**
> [handoff-transcript-stitch.md](handoff-transcript-stitch.md) — raw JSONL lines are still
> sentence fragments after `a30d12f` (38% of lines on a post-fix recording), nobody consumes
> `cont`/`midWord`/`startTs`, and a real client fact was **lost from a knowledge base** because
> the note-taking step read the fragments. Asks for a `transcript` command + stop-time
> stitching; a working reference implementation already exists in `consumer-c`.

1. **Live-narration text box stalls on "copilot kész".** The #1 field complaint (2 sessions):
   the left text/narration box stops refreshing and freezes on a terminal line, while graph/
   chart draws keep working. → Investigate the `live-narration` / `wall-liveness` stream
   lifecycle; a terminal message must not wedge the lane.

   **Status 2026-07-29 (`wall-stream-recovery` applied): NOT REPRODUCED — still open, now
   observable.** Attempted against a real wall driven through a real browser over CDP: a
   terminal-sounding narration line ("Ezzel készen vagyunk, a megbeszélés véget ért…"),
   then follow-up lines — all rendered. Repeated with an empty text, a bare "Vége.", an
   8 KB line, and "Rendben, ennyi volt mára — a wall leáll."; the lane kept rendering every
   subsequent event. So no *content* of an event puts a text box into a non-accepting state
   in the current code.

   What changed is that the next report will arrive with evidence. The client now judges
   the transport from heartbeat **absence**, so "the stream died and everything you see is
   stale" shows as `⛔ nincs kapcsolat a fallal` instead of looking identical to a quiet
   meeting. That makes the two candidate explanations distinguishable from the wall itself:
   if the strip says disconnected, it was #2 (the transport) all along; if the strip says
   listening while the box does not update, it is a genuine render-side wedge and the
   reproduction should target the box, not the stream. **Do not close this item on the
   strength of the non-reproduction** — ask for the strip's state next time it happens.
2. **SSE client does not auto-reconnect.** After a drop the wall goes stale (observed ~13 min)
   and only a hard reload recovers; box/category changes also need a reload. The server sends
   `retry: 2000` but the client never re-bootstraps. → Client reconnect + re-bootstrap on SSE
   error. (Runtime *layout* push already lands live as of `wall-chat-mirror`; this is the
   broader reconnect.)
3. **Cold-start wall latency ~20s, blank wall.** The first draw of a session has no staged
   prediction to promote, so the opening request reads as a dead wall. → A visible "drawing…"
   placeholder on the wall itself the instant a draw is requested (the pending-indicator exists
   — confirm it fires on the first/cold draw), and confirm predictive-staging warms the opener.

## P1 — high friction, hit repeatedly

4. **Soniox mangles domain jargon + proper nouns.** Most repeated transcription pain (3+
   sessions): "consumer-a"→"VPC pont", "Railway"→"realway", "MVP"→"MVE", Hungarian names
   ("Szluka"→"Sluka"). Users hand-write normalization tables into `copilot.instructions` as a
   workaround. → A custom-vocabulary / term-boost seam (Soniox context hints wired from
   `knowledge.keywords`, or a post-transcript glossary-normalization pass).
5. **`--max-minutes 120` kills capture mid-meeting; transcript splits.** At the 2h cap capture
   emitted `capture-dead`; the copilot manually restarted and had to concatenate two transcript
   segments. → Raise/omit the default for meeting mode, or auto-restart capture on the cap and
   keep one continuous transcript.
6. **Monitor forces a visible reply per event → ~31% "Csend." filler.** Empty acknowledgements
   were emitted (and some mirrored to the public wall + read aloud). → Let a poll/Monitor batch
   with no alert be a legitimate no-op turn (align with `reactive`/`silent` engagement); never
   surface filler.
7. **No `status`/`ps` view of which capture+wall belongs to which session/port.** Recurring
   cross-session confusion when stopping the right one; the +1 port auto-increment on collision
   is invisible. → A `set-copilot status --all` (or `ps`) listing running captures+walls with
   their scoped runtime dir + bound port.
8. **`wall.windows` fully overrides instead of merging.** Adding one box to `/wall` dropped the
   default boxes and tripped the "position empty" warning; the operator had to rebuild all
   defaults by hand. → Deep-merge window/box config over defaults, or an add-box CLI.
9. **Pinned info scrolls off.** The scrolling log buried the open-questions list ("kurvára
   keresem az öt nyitott kérdést"). → Ship a pinned/`latest` summary box in the default `/wall`
   layout (this is also the deferred `chat-wide` right-lower region).

## P2 — smaller / polish

10. **Orphaned foreign wall on the fixed default port.** A wall from another project on 4180
    silently served the wrong runtime dir; emits went to the right dir, the screen read the
    wrong one. → Identify a wall by its `runtimeDir`; warn/refuse when the port's wall belongs
    to a different dir; make the +1 fallback visible.
11. **`--help` / `set-copilot --help` misbehaves.** `wall --help` tried to bind (EADDRINUSE);
    top-level `--help` printed "Unknown command". → Short-circuit help before any bind; accept
    `--help`/`-h`.
12. **Clean wall shutdown looks like a crash (exit 144).** A normal meeting-end wall stop
    surfaced as a failed background command. → Exit 0 on clean SIGTERM stop.
13. **`fork` agent type assumed by the drawing contract may not exist** in every harness
    (observed on one model): `Agent type 'fork' not found`. → Fall back to `general-purpose` or
    an inline draw path, or document the requirement.
14. **Wall text box swallows newlines / markdown tables illegible.** No `white-space: pre-wrap`
    on `.line .txt` (fix reportedly already in a working tree); markdown tables arrive as
    run-on text. → Land `pre-wrap`; either render minimal markdown or document plain-text/`\n`.
15. **Mic emits spurious repeated short finals ("Igen.") during silence**, polluting the saved
    transcript. → Tighter silence/VAD gating or a short-repeated-final filter.
16. **Custom knowledge adapter can silently ignore `knowledge.sources`** (a project adapter
    hardcoded its domain dir). → Make `ctx.sources` the documented single source of truth, or
    validate/warn when an adapter never reads it.

## Product-shaped (not bugs — future direction)

- **Copilot auto-switches presentation screens** on one shared window (Meet can't share two) —
  a wall auto-cycle/director mode over layout box-positions.
- **"Mikroelőrejelzések"** — live dashboard-style micro-predictions from incremental signals
  (extends predictive-staging).
- **Screen awareness** — the copilot is blind to the UI; the operator must narrate it.
- **Naming** — "Copilot" is a Microsoft brand; the differentiator pitched is live
  narrate+analyze+visual-cue on a shared wall.

---

# Second field pass — 2026-07-28

A second mining round over the Claude Code sessions of 2026-07-25…28 (`set-promo`,
`consumer-c`, `set-core`, `consumer-f`, `consumer-a`), plus the operator's own dictated
feature list of 2026-07-28. Section **A** is what the field produced; section **B** is what the
operator explicitly asked for. Items marked *(dup)* are the same defect as an item above and
count as evidence that it is still open, not as a new entry.

The frame the operator stated for this round: *"a copilotot azt megmutassuk, hogy ez egyébként
egy együttműködő rendszer. Most ez egy nekem, a meeting résztvevőnek segítő rendszer."* — the
wall today shows what the copilot decided to publish; what it is *doing* stays in a terminal only
the operator sees. Most of section B follows from that one gap.

## A — mined from usage

### A1. `init` is an invisible prerequisite; a stale project config silently degrades the wall (P0)

Verified, not inferred, on the project that ran a live wall on 2026-07-28:
`~/code2/set-promo/set-copilot.config.json` is dated **2026-07-13** and

- has **no `wall` section at all** — so no layout/box/redaction config could be applied to it;
- sets `"runtimeDir": "/tmp/set-copilot"`, a fixed global dir that directly fights the
  session-scoped `SET_COPILOT_DIR` the `/ds`, `/dd` and `/meeting-copilot` skills export;
- still uses the **old flat-string** `knowledge.keywords` form, not `[{topic, stems}]`.

Nothing anywhere reports this. The operator's reading was *"init nélkül is régi volt a config a
projektben, ezért nem tudtuk a régi JSON fájlra beállítani az új megjelenítést a falon"* — and
that reading is correct. → `doctor` (and `init` when it finds an existing file) must report config
**age and schema drift**: unknown/legacy keys, missing `wall` section, and a `runtimeDir` that
will be overridden by the skills' env var.

### A2. The chat→wall mirror silently no-ops when the Stop hook was never installed (P0)

Same session, verified: the project has **no `.claude/hooks/` directory**, no `Stop` entry
pointing at `wall-mirror.sh` in either `set-promo/.claude/settings.json` or
`~/.claude/settings.json`, and **no `wall-mirror.enabled` marker** in any runtime dir. The hook is
*both* opt-in (marker) *and* self-gating (silent exit) — so the two independent failure modes are
each invisible. The operator's *"a mirror alapvetően nem működött, ugyanezen okból, vagy nem volt
bekapcsolva"* is exactly right, and there is no way to tell those two apart from the wall.

→ `/meeting-copilot … mirror` must **verify the hook is registered** and fail loudly if not;
`doctor` must report mirror readiness as a three-state answer (hook installed? marker set? wall
running?). This is hook-enforcement's blind spot: the enforcement is real, its *absence* is
silent.

### A3. Text box still observed not refreshing *(dup of P0 #1 / #2)*

2026-07-28, mid-meeting: *"meg még mindig nem láttuk alul frissíteni, de lehet, hogy refreshelnem
kell a szövegeset."* Third session with this symptom. Still open.

### A4. The layout does not match how the operator reads the wall (P1)

*"jelenleg a döntéseket látom bal oldalt, a chat alul, nem megy"* and *"ebbe nem látom az összes
copilotos üzenetet, nem is biztos, hogy optimális így a layoutnak az elrendezése."* Distinct from
#8 (config merge): the shipped default geometry itself is wrong for the live use. Section **B4**
is the operator's own answer to this.

### A5. Crowded at 1920px — the dev screen is not the demo screen (P1)

*"most így egy kicsit zsúfolt a kép, meg bár neked elfér a giga képernyődön, de nekem ilyen kis
gagyi 1900-as képernyőim vannak."* The wall is tuned on a large monitor and shown on a laptop or
a shared Meet window. → A density/scale pass with 1920×1080 as the reference target, not the
maximum.

### A6. Text is drawn too slowly / with the wrong line breaks (P1)

*"melós nekiállt írni az alsó szövegdobozt"*; and from the dictation, *"nem megfelelő
gyorsasággal rajzolt ki egy szöveget, nem volt jó a sortörés."* → Revisit text pacing separately
from the director's canvas pacing (text is not paced today, so the latency is upstream: turn
boundary → hook → 200 ms tail), and the wrap behaviour in the text box.

### A7. No inline formatting in a wall text line; markdown tables are illegible *(sharpens #14)*

Confirmed in code: `wall.js:349` sets the line body with `textContent`, so a text line has **no
inner formatting at all** — only `white-space: pre-wrap` (`wall.css:87`, landed in `002b3cd`)
survives, and only for newlines. Formatting exists solely inside the special payloads (graph,
chart). The operator's version: *"tipikusan nincsen belső formázása egy szövegsornak, csak
valamelyik speciális elembe tettünk bele ilyet… a markdownból a karakterre rajzolt táblázatot nem
tudtuk megjeleníteni."* → Decide explicitly: a minimal safe inline renderer (bold/code/lists/
tables) versus documenting plain text forever. **B1 makes this a blocker, not polish.**

### A8. Voice-driven layout change is expected to work (P2 → product)

*"mondhatom azt a falnak, hogy az ábra nézetet oszd meg jobb oldalt, tegyél le egy kisebb dobozt,
és akkor abból legyenek kipinelve a feladatok."* Runtime layout push exists since
`wall-chat-mirror`; what is missing is a *spoken* path to it. Overlaps **B6** (a mouse-draggable
splitter is the cheaper half of the same need).

### A9. Screen awareness, now with a concrete mechanism ask *(sharpens the product-shaped item)*

*"az lenne a tuti, hogyha tudná csinálni a képernyőképet a megnyitott Chrome-os ablakomról,
mikor arról beszélünk, hogy mit látunk."* The earlier entry said "the copilot is blind to the
UI"; this names the fix — a screenshot capture the copilot can request.

## B — the operator's feature list (dictated 2026-07-28)

Ordered as dictated; **B1 is explicitly the most important.**

1. **B1 — Render the Claude Code session itself into a wall text box, Claude-Code-like.** *"a
   Claude Code-ba futó sessionnek a falon lévő szövegboxba való megjelenítése nekem az nagyon
   hiányzik… méghozzá ugyanazzal a formázással."* Three sub-requirements, all load-bearing:
   - **Same formatting.** Today a table arrives as one bullet per text line; it must read like
     Claude Code renders it — compact and scannable. Depends on **A7**.
   - **No filler.** Drop the progress/waiting chatter (*"folyamatban", "várok", "csendben
     hallgatok"*) — this is the `hook filler filter` widened from a 40-char threshold to a real
     policy.
   - It is the *messages you write into the CC session context* that must appear, i.e. what the
     `wall-mirror` hook already targets — so this is a rendering + policy change on an existing
     seam, not a new transport. The research from session `a79afe6e` (turn boundary → jq/awk →
     `wall-emit` → 200 ms tail → SSE) is the starting point.
2. **B2 — The public zone must be able to carry the same stream as the private one.** *"jelenleg
   a public az egy általad elképzelt lehatárolás, de valójában simán lehet, hogy én a publicon
   ugyanezt a folyamatot akarom látni, mint a private-ben."* And the inverse case: **only** a
   public wall on the screen, while the private view is the operator's own Claude Code. → The
   private/public asymmetry currently baked into the *default* box set is a policy default, and
   should be configurable per window; the zone *mechanism* (and redaction) stays untouched.
3. **B3 — A pinned text box that does not move while the conversation scrolls.** *"egy
   szövegboxban a beszélgetést, egy másikban bulletpontokkal az agenda… ami nem változik,
   miközben beszélgetünk, vagy csak időnként változik."* This is backlog **#9**, and it is the
   summary box `chat-wide` deliberately deferred (`config.ts:453-455`). Now explicitly requested.
4. **B4 — The target layout, in the operator's own words.** Two columns:
   - **left**: the message stream only, "as it would go in the copilot", optionally filtered to
     fewer lines — a continuous message wall;
   - **right, upper ⅔–½**: the drawable canvas (graph / chart);
   - **right, lower**: the pinnable text box from **B3** (agenda, tasks, key decisions).

   *"És ez a hármas felosztás azt gondolom, hogy ez körülbelül mindenre elég."* Note this is
   geometry — a new `layouts` entry plus a default window using it, per the layout/box split.
5. **B5 — Keep the top activity strip, but per channel and better looking.** *"a felül az a rövid
   sáv, ami mutatja, hogy beszélek… ez jó. Itt akár ki lehet bontani csatornánként is."* Today
   `wall.js:103-112` renders a single textual liveness status (`🎙 figyelek` / `💤 csend`), not a
   per-channel (mic vs system) visual meter. → Per-channel, visual, modernized.
6. **B6 — Draggable layout splitters. "Szerintem ez nagyon kell."** *"tudjam állítani egy
   húzókával, hogy hol vannak ezek a layout határok, tehát hogy le lehessen húzni a vertikális
   meg a horizontális elválasztókat."* Note the design constraint this implies: a dragged
   splitter is a *runtime* override of a layout's `columns`/`rows`, and must not turn geometry
   into per-box state — the window→layout→position→box separation has to survive it.
7. **B7 — Autozoom + manual scale on the diagrams.** *"kellene egy autozoom, hogy folyamatosan
   kizoomol vagy belezoomol, folyamatosan autoszkálál, meg egy manuális scale."* Partially there:
   `wall.js:453` runs the Cytoscape layout with `fit: true`, so it re-fits **on relayout** — but
   there is no continuous re-fit as the graph grows, and no exposed scale control.
8. **B8 — General UI modernization.** *"jó lenne valahogy javítani rajta, modernebbé tenni,
   vizuálisabbá… szebbé, dizájnosabbá."* Pairs with **A5** (density at 1920px).

**Explicitly dropped during the dictation:** multi-screen / multi-monitor handling — the operator
started it and cut it off himself: *"maradjunk ennyinél, ne is bonyolítsuk tovább."* Recorded so
it is not re-proposed as an oversight. (The related, still-live idea is the *auto-switching*
presentation entry in "Product-shaped" above, which solves the same Meet constraint without a
second screen.)

## Suggested order for the next changes

All six are proposed in `openspec/changes/` as of 2026-07-28; none is applied yet.

1. **`wall-config-and-mirror-diagnostics`** (A1+A2) — cheapest, and it is what made a live
   meeting silently degrade twice. Nothing else is trustworthy until a misconfigured project
   says so out loud.
2. **`wall-text-formatting-and-mirror-policy`** (A7+B1) — the blocker under the #1 feature ask:
   a closed inline vocabulary for `text`, and the filler/length/code-block judgement moved into
   the existing `copilot.mirror` config seam.
3. **`wall-three-region-layout`** (B3+B4, closes #9) — the operator's geometry and the pinned box
   `chat-wide` deferred. Also closes a blank-wall hole: `badLayout` never checked that a
   multi-cell position is a rectangle.
4. **`wall-stream-recovery`** (A3, P0 #1/#2) — client-side watchdog on heartbeat *absence*,
   resumable SSE delivery, re-bootstrap on reconnect. Does not claim a root cause for the
   narration wedge; builds the visibility and carries the reproduction.
5. **`wall-public-surface`** (B2) — and it found a leak: `isPublicClient` infers the audience
   from `!zones.includes("private")`, so widening a public window's zones to "show more"
   silently turns redaction **off** in front of an audience.
6. **`wall-viewport-and-activity`** (B5+B6+B7+B8+A5) — splitters as a per-viewer viewport
   override, graph auto-fit with a manual scale that wins, per-channel activity in the
   heartbeat, and a 1920×1080 density pass.

## What worked well — protect, do not regress

Knowledge cross-referencing with source-cited contradiction-catching (the star, every meeting) ·
public/private zone judgment held under stress (salaries, a named-client PDF withheld) ·
mic/system speaker separation over 2-hour calls (the load-bearing differentiator vs `/voice`) ·
the categorized meeting summary · JSONL-transcript reuse into a docs pipeline · predictive-staging
draws · clean `capture → poll → wall → stop` lifecycle · reliable `/ds`→`/dd` dictation for plain
Hungarian.
