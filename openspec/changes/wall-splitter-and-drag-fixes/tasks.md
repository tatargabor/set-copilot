## 1. Pure drag helpers (wall-core.mjs)

- [x] 1.1 Add `dragPairShares(totalPx, aPx, bPx, deltaPx, minShare)` → `{a, b} | null`: applies the delta to the pair with the sum conserved, clamps each side to `minShare * totalPx`, returns null on non-finite/non-positive input
- [x] 1.2 Add `applyPairToTracks(trackList, index, a, b)` → splices `${a}fr ${b}fr` into entries `index`/`index+1`, leaves every other entry verbatim, returns the input unchanged on a bad index
- [x] 1.3 Extend `applyViewportOverride` with the additive pair branch, stored per axis (`columns`/`rows` = `{pair: {index, a, b}}` alongside the legacy number array; invalid → ignored silently; the pair form skips that axis's whole-array path; input template never mutated)

## 2. Handle geometry and z-order (wall.css)

- [x] 2.1 Center the handles on the gap: `.splitter-v` margin-right and `.splitter-h` margin-bottom → `calc(var(--gap) / -2 - 7px)`, with a comment tying `7px` to the `+ 6px` width term
- [x] 2.2 Lower `.graph-controls` z-index 6 → 3 (splitter stays 4); confirm badges/overlays stay `pointer-events: none`
- [x] 2.3 Correct the misleading comments (`wall.css` splitter block, `wall.js` `buildHandles` docstring): handles are in-flow grid items pinned to a trailing edge, pulled over the gap by negative margin — not "absolutely-positioned"

## 3. Drag lifecycle (wall.js)

- [x] 3.1 Remove `buildHandles` from `applyGrid`; add `syncHandles(root)` that rebuilds only when the track count or layout id changed; call it from `mountGrid` and `onLayout`
- [x] 3.2 Route the drag through the pair helpers: build `pair` overrides via `dragPairShares`/`applyPairToTracks` instead of whole-axis px arrays; degrade to whole-axis shares when a whole-axis override already exists for that axis and a second boundary is dragged
- [x] 3.3 Capture `dragLayoutId` + track count at pointerdown; on mismatch in `move`/`up`, cancel the drag (remove listeners, drop the body class, write nothing)
- [x] 3.4 Keep the in-flight override in module state during the drag and write localStorage once on release

## 4. Tests (wall-core.test.ts)

- [x] 4.1 `dragPairShares`: pair-only movement, sum conservation, floor clamping on both ends, null on bad input, untouched tracks unaffected (n=3 and n=4 cases)
- [x] 4.2 `applyPairToTracks`: preserves `auto`/`1fr`/`2fr 1fr` on untouched entries, splices the pair, returns input on a bad index
- [x] 4.3 `applyViewportOverride` pair branch: applies to one axis and preserves the other axis's declared sizes, rejects count mismatch and malformed pairs, never mutates the input template
- [x] 4.4 Existing override tests (legacy `columns`/`rows`, floor clamping) pass unchanged
