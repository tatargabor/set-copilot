## 1. Viewport override (pure)

- [ ] 1.1 Add `applyViewportOverride(template, override)` to `wall-core.mjs`: applies track sizes to a derived grid template, rejects an override whose track counts or layout id do not match, and clamps each track so a region cannot collapse (D3).
- [ ] 1.2 Unit-test it: applied, mismatched track count rejected, mismatched layout id rejected, clamping at both ends, and that the function cannot reach a box (structural — it takes a template, not a window).

## 2. Splitters (client)

- [ ] 2.1 Render draggable handles on the boundaries between regions, derived from the grid — one per internal column and row boundary.
- [ ] 2.2 Drag updates the override and re-applies the template live; persist per window route + layout id in browser storage (D1/D2).
- [ ] 2.3 Re-apply the stored override on mount and after a reconnect re-bootstrap; discard it when the window's layout id has changed.
- [ ] 2.4 Add the reset affordance that returns to the layout's declared proportions (design open question: placement).
- [ ] 2.5 Style the handles: visible enough to find, quiet enough not to compete with content; both themes.

## 3. Graph fit and scale

- [ ] 3.1 Add a per-visual fit mode (`auto` | `manual`) to the graph renderer; suppress the automatic fit while manual (D4).
- [ ] 3.2 Re-fit when the region resizes (including from a splitter drag) — only while automatic.
- [ ] 3.3 Reset to `auto` and fit when a graph `reset` introduces a new visual.
- [ ] 3.4 Add the manual scale control and the explicit return to automatic fitting.

## 4. Per-channel heartbeat (server)

- [ ] 4.1 Extend the heartbeat to carry per-channel activity, grouping the existing transcript read by the `speaker` tag — same derivation path as `lastHeardMsAgo`, server-side only (D5).
- [ ] 4.2 Represent an unused channel as **absent**, distinct from silent, so a `--mic-only` capture does not render as a broken meeting capture (D5).
- [ ] 4.3 Update the heartbeat type in `src/wall/types.ts`; keep the existing fields so an older client is unaffected.
- [ ] 4.4 Tests: both channels active; one active one quiet; a mic-only capture reports the system channel absent; the injected-heartbeat rejection still holds.

## 5. Activity strip (client)

- [ ] 5.1 Add pure `stripState(heartbeat, thresholds)` to `wall-core.mjs` returning per-channel state; unit-test listening/quiet/absent/capture-stopped combinations (D6).
- [ ] 5.2 Render two channel indicators visually rather than as a sentence; keep the existing three overall states distinguishable.
- [ ] 5.3 Keep the strip's height inside the density budget (D6/D7).

## 6. Density pass

- [ ] 6.1 Type scale, spacing rhythm, and box padding tuned against 1920×1080; both light and dark (D7).
- [ ] 6.2 Re-check the boxes that carry the most content — the stream lane and the pinned region — at that size specifically.

## 7. Verify

- [ ] 7.1 `npm run build` clean under `tsc` strict; `npm test` green.
- [ ] 7.2 Drag both a vertical and a horizontal boundary; confirm the proportions change, persist across a reload, and that no box changed its behavior or subscriptions.
- [ ] 7.3 Switch the window's layout at runtime and confirm the declared proportions apply, not the stale override.
- [ ] 7.4 Grow a graph across several deltas and confirm it stays fitted; set a manual scale and confirm a further delta does not re-fit; return to automatic and confirm it fits again; reset the visual and confirm it starts fitted.
- [ ] 7.5 Speak on the mic with the system channel silent and confirm the strip shows the difference at a glance; run a `--mic-only` capture and confirm the system channel reads as absent.
- [ ] 7.6 Review the whole wall at 1920×1080 — not the development monitor — in both themes.
