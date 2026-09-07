## Context

The drag path lives in three client files: `wall-core.mjs` holds the pure logic
(`gridTemplate`, `applyViewportOverride`, `clampShares`, `MIN_TRACK_SHARE`), `wall.js` the
DOM (handle creation, pointer lifecycle, localStorage), `wall.css` the handle geometry.
Handles are **in-flow grid items** placed in track `i` (the boundary between tracks `i` and
`i+1`), pinned to a trailing edge and pulled over the gap by a negative margin; the visible
bar is the item's `::after`. `applyGrid` is currently the single funnel: it re-derives the
template, applies the override, AND rebuilds every handle — on every pointermove. The
stored override form is relative `fr` shares resolved from px measurements taken at
`pointerdown`. See proposal.md for the defect list; the offset sign error is the reported
bug.

Constraint carried over from `wall-viewport-and-activity` (now in the base spec): an
override is per-viewer, localStorage-only, never reaches the server, and
`applyViewportOverride` stays pure and template-in.

## Goals / Non-Goals

**Goals:**

- The separator reads as the boundary: bar centered in the gap, hit-strip mostly over the
  gap, on both axes.
- Dragging one boundary moves only that boundary's pair; every other track keeps its
  declared size — including `auto` — until its own boundary is dragged.
- The pointer gesture survives its own duration: no DOM churn under the pointer, no
  geometry written against a layout that changed mid-drag.
- Legacy overrides keep resolving; existing tests pass unchanged.

**Non-Goals:**

- No server, config, or skill changes; no new endpoint or event.
- No redesign of layout resolution or the three-layer model.
- `clampShares` stays (legacy override path + safety net) — it is not deleted.
- The cosmetic 12px `::after` end insets are not touched.

## Decisions

**1. Restrict redistribution to the dragged pair; keep the floor.**
`dragPairShares(totalPx, aPx, bPx, delta, minShare)` moves the pair with the sum conserved
and each side clamped to `minShare * totalPx`; when the pair saturates at the floor the
drag simply stops. Alternative considered: keep global water-filling (current `clampShares`)
— rejected because it moves dividers the operator is not touching, which is the same
complaint family as the offset bug. The pair always has room to satisfy the floor: both
tracks start ≥ floor (the previous state was clamped) and the pair's sum is conserved, so
both can always return to ≥ floor. Redistribution across other tracks buys nothing the
floor needs.

**2. Splice the pair into the track list; leave every other track verbatim.**
`applyPairToTracks(trackList, index, a, b)` replaces only entries `index`/`index+1` with
`${a}fr ${b}fr`. This is what preserves `auto` (and any other non-`fr` declaration) on
untouched tracks — the current path rewrites the whole axis from px measurements, which is
how a pinned `latest` row silently became a fixed fraction. The override gains an additive
`pair = {axis, index, a, b}` branch, validated like the existing arrays and ignored
silently when malformed; a legacy `columns`/`rows` override stays valid. Degradation,
documented: if a whole-axis override exists and the operator drags a *second* boundary on
that axis, the measured px are baked to shares for the whole axis (both forms cannot hold
one axis; the newer gesture wins, exactly like today).

**3. Handles rebuild only when the grid's shape changes.**
Handles depend on track *count*, never track *size* — as grid items they move with the
tracks automatically. So `buildHandles` leaves `applyGrid` entirely; a `syncHandles(root)`
no-ops unless the track count (or layout id) changed, called from `mountGrid` and
`onLayout`. Alternative considered: keep rebuilding but re-attach pointer capture — rejected
as more machinery for the same outcome, and it would leave :hover/dblclick targets churning
per frame.

**4. The splitter wins the pointer at the crossing.**
`.graph-controls` z-index 6 → 3, below the splitter's 4. Raising the splitter instead was
rejected: it would shade the zoom buttons with the (invisible) hit-strip and make them
unclickable. Badges/overlays stay above — they are `pointer-events: none`. With the offset
fixed, only ~3px of the strip overlaps any panel edge, so a control near the edge remains
reachable.

**5. Cancel the drag when the layout changed under the pointer.**
`dragLayoutId` and the track count are captured at `pointerdown`; `move`/`up` verify them
and otherwise end the gesture without writing anything. This closes the stale-template hole
where a runtime `wall-layout` switch or reconnect-bootstrap could persist a measurement
against a different arrangement.

**6. One localStorage write per gesture.**
The override being built lives in module state during the drag (`applyGrid` prefers it over
`readOverride`); it is written once on release. Two synchronous localStorage ops per
mousemove were pure waste; no behavioral change is intended, so no test targets this.

## Risks / Trade-offs

- [The new `7px` half-width constant and the `+ 6px` in the width calc must move together]
  → a comment at both places says so; the calc is written as `var(--gap) / -2 - 7px` so the
  two terms stay readable as "half the gap, half the handle".
- [Second-boundary degradation bakes px to whole-axis shares, converting untouched `auto`
  tracks on that axis] → accepted and documented; it is strictly the operator's own second
  gesture on one axis, and today's code does that on the *first* drag.
- [Drag-path refactor and mid-drag guard both touch `applyGrid`'s callers] → landed as one
  change, handle-rebuild first, so `applyGrid` stops being a do-everything funnel exactly
  once.

## Migration Plan

None needed: additive client behavior, per-viewer localStorage state. Overrides stored by
existing viewers keep resolving (legacy form untouched; a `pair` form did not exist before).
Rollback = revert the commit.

## Open Questions

None.
