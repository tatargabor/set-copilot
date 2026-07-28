## Why

Asked for the layout he actually wants, the operator described it precisely
(`docs/wall-field-backlog.md` §B4): a left column carrying only the message stream; the
right column split, with the drawable canvas on top and a **pinnable** text box under it
for the agenda, the tasks, the key decisions — *"és ez a hármas felosztás azt gondolom,
hogy ez körülbelül mindenre elég."*

Two field observations converge on the same shape:

- **Pinned information scrolls off.** Backlog #9, from a live meeting: the scrolling log
  buried the open-questions list (*"kurvára keresem az öt nyitott kérdést"*). Every shipped
  layout gives the text stream a `scroll` box and nothing that survives it.
- **The current geometry does not match how the wall is read.** *"jelenleg a döntéseket
  látom bal oldalt, a chat alul, nem megy"*, and *"ebbe nem látom az összes copilotos
  üzenetet, nem is biztos, hogy optimális így a layoutnak az elrendezése"* (§A4). The
  `chat-wide` layout deliberately deferred a dedicated pinned box rather than shipping an
  empty third region (`src/config.ts:453-455`) — this is that deferral coming due.

There is also a latent way to get a blank wall that this change closes. `badLayout`
(`src/wall/layout.ts:33`) validates row widths and track counts, but not that a position
repeated across rows forms a **rectangle**. A layout like `[["a","b"],["b","a"]]` passes
validation and produces a `grid-template-areas` string the browser rejects outright —
which drops the whole property and renders nothing. Any multi-row layout, including the one
this change ships, walks straight into that hole.

## What Changes

- **A three-region layout**, shipped as config: the stream column spanning both rows on the
  left, the canvas top-right, the pinned box bottom-right. Proportions follow the operator's
  description (canvas roughly two thirds of the right column's height).
- **A pinned reference region in the default wall**, with a `latest` box: content stays put
  until it is explicitly replaced, and the live stream can never displace it. This closes
  backlog #9.
- **A category for pinned reference content**, with a box policy stating what belongs there
  (agenda, open questions, decisions, tasks) and that it changes occasionally rather than
  continuously — so it is content, not another stream.
- **Rectangularity validation for layout positions**, with the same posture as the rest of
  layout resolution: warn and drop the window, never serve a blank page.
- Non-goals: no change to the box/layout/position separation, no new render type, no new
  behavior kind (`latest` already does what a pinned box needs), no draggable splitters
  (that is its own change), and no change to the existing shipped layouts.

## Capabilities

### Modified Capabilities
- `display-layout`: a layout position occupying several cells must be validated as a
  rectangle before it reaches the client, and the default wall must offer a pinned region
  that the scrolling stream cannot displace.

## Impact

- `src/config.ts` — one new entry in `DEFAULT_LAYOUTS`, one new category, and the box
  assignment plus policy in `DEFAULT_WINDOWS`.
- `src/wall/layout.ts` — `badLayout` gains the rectangularity check.
- `src/wall/layout.test.ts` — the new validation case; existing layouts must still resolve.
- `src/wall/public/wall.css` — the pinned region's styling; no change to `gridTemplate`,
  which already emits `grid-template-areas` row by row and therefore spans correctly.
- `skills/meeting-copilot/SKILL.md` — how the copilot updates the pinned box (it is a
  `latest` box, so an update replaces the whole content).
