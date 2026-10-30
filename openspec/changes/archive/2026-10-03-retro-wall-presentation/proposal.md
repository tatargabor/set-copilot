# Proposal

## Why

This is a **retro-spec**. Three wall features shipped as ad hoc commits with no OpenSpec
change behind them — presentation mode for a wall shared with an audience (0196660, built
the night before a client call, with the commit itself asking for the spec to be written
after the fact), the live transcript page (15c0a07, 14950a2), and the `wall-shot` screenshot
command (0edb6ff) — together with graph-rendering drift (3380850) that the `display-layout`
spec now partly contradicts. Today the code is the only source of truth for them. This change
describes what the code ALREADY does, so OpenSpec can lead development of the wall again.

## What Changes

Specs only — no source code changes.

- New capability `wall-presentation`: the `wall.presentation` chrome (title bar, chrome
  locale, hidden operator input, theme, type scale, box headings), ticker bands, overflow
  auto-scroll with a per-viewer toggle, the full-screen canvas, the canvas visual tabs with
  Auto-follow, and the server-side replay of every visual with its title — and the rule
  that none of this ever decides which content reaches which zone.
- New capability `wall-transcript-page`: the opt-in live transcript page and its polled
  `/api/transcript` byte-offset cursor, turn grouping, live-edge following, reading order,
  DOM budget, and textContent-only rendering.
- New capability `wall-screenshot`: `set-copilot wall-shot <url>` — headless Chromium to a
  PNG under the runtime dir, emitted as an in-project `image` event.
- `display-layout`: the graph render's layout choice (preset positions, flow direction from
  the canvas's aspect, a first appearance laid out in place) replaces "every delta runs an
  animated layout"; only a real viewer gesture switches a graph to manual scale.
- `display-categories`: graph node/edge presentation attributes (`tone`, `parent`,
  `invisible`, `x`/`y`, `image`) and the optional event `title`. Its `## Purpose` placeholder
  is replaced with a real one on sync, which also makes the spec pass `--strict`.
- `public-redaction`: the transcript page is a further public surface, run through the same
  redaction taxonomy, on by default and failing closed — but outside the ingest funnel and
  outside the audience model.

## Capabilities

### New Capabilities
- `wall-presentation`: audience-facing chrome and viewer conveniences of the wall window.
- `wall-transcript-page`: the live, polled transcript page served by the wall.
- `wall-screenshot`: the `wall-shot` command that puts a rendered web page on the wall.

### Modified Capabilities
- `display-layout`: graph layout selection and the gesture-only manual-scale switch.
- `display-categories`: graph node/edge presentation attributes and the event `title`.
- `public-redaction`: redaction of the transcript page.

## Impact

None on code, APIs or dependencies. Affected specs: three new, three modified. The behaviour
described lives in `src/wall/public/wall.js`, `src/wall/public/wall.css`,
`src/wall/public/transcript.{html,js}`, `src/wall/server.ts`, `src/wall/emit.ts`,
`src/wall/types.ts`, `src/config.ts` and `src/cli.ts` (`cmdWallShot`).
