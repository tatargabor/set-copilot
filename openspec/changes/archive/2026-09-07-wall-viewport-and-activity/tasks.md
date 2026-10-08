## 1. Viewport override (pure)

- [x] 1.1 Add `applyViewportOverride(template, override)` to `wall-core.mjs`: applies track sizes to a derived grid template, rejects an override whose track counts or layout id do not match, and clamps each track so a region cannot collapse (D3).
      Signature is `(template, override, layoutId)` — the layout id is a third argument rather
      than a field on the template, so the function still takes only geometry and `gridTemplate`'s
      contract is untouched. Clamping is water-filling to `MIN_TRACK_SHARE` (6%), not a per-value
      `Math.max`: raising a starved track has to take the space from somewhere, and taking it
      proportionally is what keeps the *other* boundaries where the viewer put them.
- [x] 1.2 Unit-test it: applied, mismatched track count rejected, mismatched layout id rejected, clamping at both ends, and that the function cannot reach a box (structural — it takes a template, not a window).
      11 tests in `wall-core.test.ts`, including a multi-track starvation case and a
      no-mutation check.

## 2. Splitters (client)

- [x] 2.1 Render draggable handles on the boundaries between regions, derived from the grid — one per internal column and row boundary.
      Handles are grid children placed by line number, pinned to the trailing edge of the
      region before the boundary and pulled half their width outward — they straddle the gap
      and occupy no track of their own, so they stay out of the layout arithmetic entirely.
- [x] 2.2 Drag updates the override and re-applies the template live; persist per window route + layout id in browser storage (D1/D2).
      The drag measures in **resolved px** (`getComputedStyle`), then hands those numbers to
      the pure function, which normalises and clamps them. Storage key is
      `set-copilot:wall:viewport:<route>:<layoutId>`.
- [x] 2.3 Re-apply the stored override on mount and after a reconnect re-bootstrap; discard it when the window's layout id has changed.
      One funnel (`applyGrid`) for mount, layout switch, drag and reset — the failure mode
      otherwise is an override that survives a switch on one path and not another. Keying
      storage per layout is what makes "discard on a switch" and "find it again on switching
      back" the same rule instead of two.
- [x] 2.4 Add the reset affordance that returns to the layout's declared proportions (design open question: placement).
      **Decided: the strip, plus a double-click on any boundary.** The strip is the one piece
      of furniture guaranteed to exist in every window and every layout — the same reason the
      liveness status lives there — so a layout that fills every position cannot hide the
      escape hatch. It is hidden until an override exists, so an undragged wall carries no
      extra chrome.
- [x] 2.5 Style the handles: visible enough to find, quiet enough not to compete with content; both themes.

## 3. Graph fit and scale

- [x] 3.1 Add a per-visual fit mode (`auto` | `manual`) to the graph renderer; suppress the automatic fit while manual (D4).
      **Bug found and fixed during verification:** the "this move is ours" guard was a boolean
      released on the next animation frame, but an animated layout emits `zoom`/`pan` for its
      whole 350 ms — so the tail of every automatic fit was read as the viewer taking control,
      and the graph silently switched itself to manual. Replaced with a deadline covering the
      animation. Reproduced in a real browser (`manual:true` after three plain deltas), fixed,
      re-verified.
- [x] 3.2 Re-fit when the region resizes (including from a splitter drag) — only while automatic.
      `ResizeObserver` on the pane, plus an explicit `refit()` at the end of a splitter drag.
- [x] 3.3 Reset to `auto` and fit when a graph `reset` introduces a new visual.
- [x] 3.4 Add the manual scale control and the explicit return to automatic fitting.
      Three buttons in the graph pane (−, +, ⤢), the last marked while manual is in effect so
      "why is this not re-fitting?" has a visible answer.

## 4. Per-channel heartbeat (server)

- [x] 4.1 Extend the heartbeat to carry per-channel activity, grouping the existing transcript read by the `speaker` tag — same derivation path as `lastHeardMsAgo`, server-side only (D5).
      Pure derivation in `src/wall/channels.ts`; `server.ts` reads a bounded 256 KB tail once
      per beat. A line's `ts` is ms since capture start, so the file's mtime — the anchor
      `lastHeardMsAgo` already trusts — is what turns the per-channel offsets into ages.
      Nothing new is believed.
- [x] 4.2 Represent an unused channel as **absent**, distinct from silent, so a `--mic-only` capture does not render as a broken meeting capture (D5).
      Derived from `capture.output`, the marker the capture itself writes. This also fixed a
      pre-existing lie: the wall aged off the *configured meeting* transcript even during a
      dictation run, reporting a "last heard" from a session that ended hours ago. The
      heartbeat now follows the capture's own output file.
- [x] 4.3 Update the heartbeat type in `src/wall/types.ts`; keep the existing fields so an older client is unaffected.
- [x] 4.4 Tests: both channels active; one active one quiet; a mic-only capture reports the system channel absent; the injected-heartbeat rejection still holds.
      9 pure tests (`channels.test.ts`) + 4 over the real SSE wire (`server.liveness.test.ts`),
      including the stale-meeting-transcript case.

## 5. Activity strip (client)

- [x] 5.1 Add pure `stripState(heartbeat, thresholds)` to `wall-core.mjs` returning per-channel state; unit-test listening/quiet/absent/capture-stopped combinations (D6).
      Five states, one of them `unknown`: a **disconnected** stream reports unknown rather than
      a remembered verdict, because every age in a stale heartbeat is at least as old as the
      heartbeat itself — painting a confident "active" from it is the exact failure
      `wall-stream-recovery` exists to prevent.
- [x] 5.2 Render two channel indicators visually rather than as a sentence; keep the existing three overall states distinguishable.
      Read as a **shape** first: a filled pulsing bar (heard), a thin flat bar (quiet), a
      dashed outline (absent). Colour repeats the fact; the tooltip spells it out. The strip is
      built once and updated in place — rebuilding it every second restarted the pulse, so an
      active channel never actually looked alive.
- [x] 5.3 Keep the strip's height inside the density budget (D6/D7).
      Strip padding and font moved into the same `:root` budget as the boxes; measured height
      ~26 px of 1080.

## 6. Density pass

- [x] 6.1 Type scale, spacing rhythm, and box padding tuned against 1920×1080; both light and dark (D7).
      The budget is variables in one place (`--gap`, `--box-pad`, `--radius`, `--font`,
      `--font-sm`, `--strip-pad`) so a pass is a pass, not a per-component negotiation. Body
      15→16 px with a tighter 1.4 line-height, gap and padding 10→8/10-12, line rhythm 4→3 px.
      A `prefers-color-scheme: light` palette was added: a projector in a bright room is the one
      place the dark wall loses, and the palette was already variables.
      **Found while reviewing:** cytoscape paints to a canvas and cannot inherit CSS, so the
      graph stayed dark-on-dark in the light theme — the one element that did not belong to the
      page. Its palette is now read from the same variables, and follows a live theme change.
- [x] 6.2 Re-check the boxes that carry the most content — the stream lane and the pinned region — at that size specifically.
      Stream lane: tighter line rhythm, the timestamp stepped back so the words get the width.
      Pinned region: a step up in size over the flowing lane (17 px) and a tighter list rhythm,
      so a six-point agenda fits without scrolling.

## 7. Verify

- [x] 7.1 `npm run build` clean under `tsc` strict; `npm test` green.
- [x] 7.2 Drag both a vertical and a horizontal boundary; confirm the proportions change, persist across a reload, and that no box changed its behavior or subscriptions.
      Real Chromium at 1920×1080 over CDP: columns 948/948 → 648/1248 on a −300 px drag, rows
      629/314 → 428/514 on a −200 px drag, both exact. Survived a reload. Box behavior, cats
      and pacing identical to the server's bootstrap before and after.
- [x] 7.3 Switch the window's layout at runtime and confirm the declared proportions apply, not the stale override.
      `wall-layout /wall chat-wide` with an override in effect → 948/948 (chat-wide's declared
      1fr 1fr), one handle instead of two, reset affordance hidden. Switching back to
      `három-régió` restored that layout's own override.
- [x] 7.4 Grow a graph across several deltas and confirm it stays fitted; set a manual scale and confirm a further delta does not re-fit; return to automatic and confirm it fits again; reset the visual and confirm it starts fitted.
      zoom 3.363 fitted → manual 2.690 → a 3-node delta left it at 2.690 (9 nodes, still
      manual) → ⤢ refit to 1.998 fitted → a `reset` on a new visual came up at 2.049, fitted,
      auto.
- [x] 7.5 Speak on the mic with the system channel silent and confirm the strip shows the difference at a glance; run a `--mic-only` capture and confirm the system channel reads as absent.
      `én: beszél` (active bar) next to `mások: csendben (1 perc óta)` (flat bar); after
      switching `capture.output` to a dictation file, `mások: nincs csatorna` (dashed).
- [x] 7.6 Review the whole wall at 1920×1080 — not the development monitor — in both themes.
      Screenshots captured over CDP at exactly 1920×1080 and reviewed in both themes. One gap
      noted and filed rather than silently fixed: a `##` heading renders literally, because the
      text vocabulary is closed by design and has no heading node — backlog P2 #17.
