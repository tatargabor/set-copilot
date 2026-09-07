## Why

The draggable splitters misbehave in ways the operator sees every session: the visible
separator bar is drawn ~8px off the boundary — inside the left/top region instead of
centered in the gap (a sign error in the handle margin calc) — so the bar reads as having
"slipped into the other side", and most of its hit-strip overlays panel content instead of
the divider. Around that root cause sit five more drag-path defects: the graph-zoom
controls steal the splitter's clicks at the handle crossing, every pointermove destroys and
recreates the handle under the pointer, dragging one boundary can move *other* dividers
(water-filling across all tracks), the first drag silently converts `auto` rows to `fr`
(defeating "a pinned region the stream cannot displace"), and a layout switch landing
mid-drag can persist geometry nobody chose.

## What Changes

- Fix the handle offset so `.splitter-v` / `.splitter-h` center on the gap on both axes
  (`margin-right`/`margin-bottom`: −3px → −11px at gap 8px), and correct the comments that
  misdescribe the handle mechanism (in-flow grid items pinned to a trailing edge, not
  "absolutely-positioned").
- Lower `.graph-controls` z-index below the splitter so the separator wins pointer
  interaction at the crossing (badges/overlays keep `pointer-events: none`).
- Rebuild handles only when the grid's *shape* changes (layout switch / bootstrap), never
  during a drag — the pointer-captured element survives the whole gesture.
- Restrict drag redistribution to the dragged boundary's track pair: dragging one divider
  never moves another. New pure helpers `dragPairShares` + `applyPairToTracks` carry this
  and preserve untouched non-`fr` track declarations (`auto` stays `auto` until its own
  boundary is dragged), via an additive `pair` branch on `applyViewportOverride`. The legacy
  whole-axis override remains valid and clamped as before.
- Cancel a drag instead of writing an override when the layout id or track count changed
  mid-gesture.
- Write the viewport override to localStorage once per drag (on release), not on every
  mousemove.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `display-layout`: the requirement "Track sizes may be overridden at view time without
  altering the layout" gains the drag-behavior guarantees (pair-only redistribution,
  untouched tracks preserved verbatim, handle centered on the boundary, splitter wins the
  pointer at overlay crossings, mid-drag layout switch discards the gesture) while keeping
  every existing scenario's intent.

## Impact

- `src/wall/public/wall.css`, `src/wall/public/wall.js` — handle offset, z-order, handle
  rebuild discipline, drag lifecycle.
- `src/wall/public/wall-core.mjs` — new pure helpers; additive `pair` branch on
  `applyViewportOverride` (stays pure and template-in).
- `src/wall/wall-core.test.ts` — new coverage; existing override tests must keep passing
  unchanged (compat proof for the legacy path).
- No server, config, or skill changes. Overrides stored by existing viewers keep resolving
  (the `pair` branch is additive; the legacy `columns`/`rows` form is untouched).
