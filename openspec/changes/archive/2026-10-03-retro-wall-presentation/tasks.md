# Tasks

Retro-spec: every task is a verification of existing behaviour against the code, not an
implementation step. Line numbers are as of HEAD 8a5a725 (`src/cli.ts` and `src/config.ts`
read via `git show HEAD:<file>`); each task also names the function or constant it checked.
`npx vitest run src/wall/server.transcript.test.ts src/config.test.ts src/wall/redaction.test.ts`
passed (104 tests) at the time of writing.

## 1. wall-presentation

- [x] 1.1 Verify presentation is applied browser-side only (bootstrap hands it over; routing, redaction and accumulation never read it) against src/wall/server.ts:1157 and src/wall/public/wall.js:46 (`applyPresentation`) [REQ: Presentation is chrome only, never a content control]
- [x] 1.2 Verify per-field fallback (title/subtitle trim, locale, hideInput, theme set, scale 0.75–2, boxTitles/tickers filtering, autoScroll) against src/config.ts:770 (`resolvePresentation`) and src/config.test.ts:468 [REQ: Presentation fields resolve one by one with a fallback]
- [x] 1.3 Verify title bar, browser tab title, hidden input, studio/studio-dark theme and `--scale` against src/wall/public/wall.js:46, wall.js:110, wall.js:542 and src/wall/public/wall.css:546 / wall.css:929 [REQ: Title bar, hidden input, theme and scale]
- [x] 1.4 Verify box headings come from `boxTitles[position]` via `data-title` against src/wall/public/wall.js:138 and src/wall/public/wall.css:656 [REQ: Box headings per position]
- [x] 1.5 Verify ticker items are cloned rendered nodes, marquee/rotate modes, empty-items fallback and no auto-scroll on ticker boxes against src/wall/public/wall.js:1002 (`decorateTicker`), wall.js:1013 and wall.js:147 [REQ: Ticker bands reuse the rendered text, never re-parsed markup]
- [x] 1.6 Verify ping-pong auto-scroll on overflow, hover pause, per-route-and-position toggle in localStorage with try/catch fallback against src/wall/public/wall.js:931 (`attachAutoScroll`) [REQ: Overflowing reference boxes scroll themselves, with a per-viewer toggle]
- [x] 1.7 Verify full-screen toggle on paced boxes, F/Esc keys, input-field and modifier guard against src/wall/public/wall.js:150, wall.js:900 (`attachMaximize`) and wall.js:915 [REQ: The canvas can take the whole wall]
- [x] 1.8 Verify tabs (≥2 visuals, title-or-id labels, Auto/A, ←/→, follow vs. marked server pick, most recent graph box owns the keys) against src/wall/public/wall.js:1391 (`renderTabs`), wall.js:1415 and wall.js:1444 [REQ: Canvas tabs over every visual, following the conversation by default]
- [x] 1.9 Verify reconnect replays the other visuals unshown then the shown one with `show`, titles from the zone slice, redaction-id guard for public against src/wall/server.ts:1014 and server.ts:1020–1045 (`replay`) [REQ: Reconnect replays every visual with its title]

## 2. wall-transcript-page

- [x] 2.1 Verify opt-in route (must start with `/`), 404 without it, title default and speaker labels from `transcript.speakers` against src/config.ts:1299 (HEAD), src/wall/server.ts:1161 and src/wall/server.transcript.test.ts:111 [REQ: The transcript page is opt-in by route]
- [x] 2.2 Verify byte-offset cursor, path+inode id reset, held-back partial line, skipped non-final lines, 1 MB first-read cap and 2 MB per-poll cap, active file from `capture.output` against src/wall/server.ts:1200 (`handleTranscript`), server.ts:246–248, server.ts:456 (`activeTranscript`), server.ts:1257 and src/wall/server.transcript.test.ts:51–89 [REQ: Lines are read by byte offset from the file the capture is writing]
- [x] 2.3 Verify turn grouping (speaker change or >12 s without `cont`), word joining, live-edge follow with Live button, newest-first rebuild, text size remembered against src/wall/public/transcript.js:15, transcript.js:114–120, transcript.js:58 and transcript.js:60 (`applyView`) [REQ: The page groups fragments into turns and follows the live edge]
- [x] 2.4 Verify the 5000-fragment budget (current turn kept), textContent-only insertion and theme following against src/wall/public/transcript.js:19, transcript.js:120 and src/wall/public/transcript.html:23–53 [REQ: The page is bounded and inserts text as text only]

## 3. wall-screenshot

- [x] 3.1 Verify browser resolution order, 1280×800 headless render, 45 s timeout and the non-zero exits (no URL, no browser, failed shot) against src/cli.ts:1120 (`BROWSER_BINS`) and src/cli.ts:1145 (`cmdWallShot`, HEAD) [REQ: wall-shot renders a URL with a headless browser at a fixed size]
- [x] 3.2 Verify PNG under `<runtimeDir>/shots/`, project-relative `src`, defaults (category `architektúra`, zone `both`, priority immediate), ingest confinement and exit non-zero when nothing emitted against src/cli.ts:1163–1186 (HEAD) and src/wall/emit.ts:90 (`badImage`) [REQ: The shot is emitted as an in-project image, or not at all]

## 4. display-layout

- [x] 4.1 Verify A-path redraw, preset layout for numeric x/y, flow direction by the 1.6 aspect threshold, animation only for the last-drawn visual against src/wall/public/wall.js:1305, wall.js:1311 and wall.js:1314 (`draw`) [REQ: Render types]
- [x] 4.2 Verify only a real gesture (zoom buttons, or zoom/pan within 1.5 s of wheel/pointer input and outside the drive window) switches to manual against src/wall/public/wall.js:1245 and the `drive`/`quietUntil` logic in `makeGraphSlot` [REQ: A graph keeps itself fitted, and a manual scale suspends that]

## 5. display-categories

- [x] 5.1 Verify node `tone` roles, `parent` group boxes, `invisible` edges, edge labels, node `image` via `/media` with serve-time confinement and leaf-scrub redaction against src/wall/public/wall.js:1217–1226, wall.js:1291 and src/wall/server.ts `serveMedia`, src/wall/redaction.ts:201 (`redactValue`) / :219 (`urlSourcesMatch`) [REQ: Graph nodes and edges carry optional presentation attributes]
- [x] 5.2 Verify `title` trimmed and cut to 80 at ingest, kept per zone slice, public slice stores the scrubbed copy against src/wall/emit.ts:193 and src/wall/server.ts:796–800 [REQ: An event may name its visual with a short title]

## 6. public-redaction

- [x] 6.1 Verify transcript lines are scrubbed with the wall taxonomy unless `redact: false`, a still-matching or unscrubbable line becomes the replacement marker, and the path is outside ingest and audience against src/wall/server.ts:1254 (`transcriptPageLine`), server.ts:1264, src/config.ts:1309 (HEAD) and src/wall/server.transcript.test.ts:79 [REQ: The transcript page is a public surface redacted by the same taxonomy]
