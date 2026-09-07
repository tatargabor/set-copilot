## Why

The remaining items on the operator's list are all about the wall as a *surface being
looked at*, and they were dictated together (`docs/wall-field-backlog.md` §B5–B8, §A5):

- **Splitters.** *"tudjam állítani egy húzókával, hogy hol vannak ezek a layout határok,
  tehát hogy le lehessen húzni a vertikális meg a horizontális elválasztókat. Szerintem ez
  nagyon kell."* Track sizes are fixed config fractions today; adapting a wall to what is
  actually on it means editing config and reloading.
- **Graph zoom.** *"kellene egy autozoom, hogy folyamatosan kizoomol vagy belezoomol,
  folyamatosan autoszkálál, meg egy manuális scale."* The Cytoscape layout runs with `fit:
  true` (`src/wall/public/wall.js:453`), so a graph re-fits when it re-lays-out — but never
  between layouts, and there is no scale control at all.
- **Activity strip, per channel.** *"a felül az a rövid sáv, ami mutatja, hogy beszélek, ez
  jó. Itt akár ki lehet bontani csatornánként is."* The strip renders one textual state
  (`wall.js:103-112`) derived from a heartbeat that carries only `captureAlive` and
  `lastHeardMsAgo` — so it cannot distinguish the mic from the system channel, which is the
  project's load-bearing primitive.
- **Density and modernization.** *"most így egy kicsit zsúfolt a kép… nekem ilyen kis gagyi
  1900-as képernyőim vannak"* and *"jó lenne modernebbé tenni, vizuálisabbá, szebbé."* The
  wall is tuned on a large monitor and shown on a laptop or a shared meeting window.

The thread through all four: today the wall's presentation is fixed at config time, and the
operator adapts by editing files and reloading — during a meeting.

## What Changes

- **Draggable splitters.** A viewer may adjust a layout's track sizes by dragging the
  boundaries between regions, and the adjustment persists for that viewer.
- **The adjustment is a viewport override, not box state.** It changes the geometry a
  window is rendered with; it does not change what any box holds, how it behaves, or the
  layout definition itself. Resetting returns to the layout's declared proportions.
- **Continuous graph auto-fit plus a manual scale.** A graph keeps itself fitted as it
  grows; a manual scale takes over when the viewer uses it, and auto-fit resumes only on an
  explicit return.
- **Per-channel activity in the liveness signal.** The heartbeat carries activity per
  speaker channel, and the strip shows the mic and the system channel separately, as a
  visual indication rather than a sentence.
- **A density pass with a stated reference target** of 1920×1080 — the operator's actual
  screen — covering type scale, spacing, and the strip's own footprint.
- Non-goals: no layout *editing* (creating positions, moving boxes) from the wall, no
  multi-screen handling (explicitly dropped by the operator), no new render type, no change
  to zoning, redaction, or the event schema, and no styling configuration surface.

## Capabilities

### Modified Capabilities
- `display-layout`: a window's track sizes MAY be overridden at view time without altering
  the layout definition or any box, and the `graph` render gains continuous fitting with a
  viewer-controlled scale that suspends it.
- `wall-liveness`: the liveness signal carries per-channel activity, and the status strip
  distinguishes the mic and system channels.

## Impact

- `src/wall/public/wall.js` — splitter handles, drag handling, the graph fit/scale
  controller, and the per-channel strip.
- `src/wall/public/wall-core.mjs` — the pure parts: applying an override to a layout's
  tracks, and deriving the per-channel strip state from a heartbeat.
- `src/wall/public/wall.css` — splitter affordances, the strip, and the density pass.
- `src/wall/server.ts` — the heartbeat gains per-channel activity, derived from the
  transcript exactly as the existing `lastHeardMsAgo` is (server-side, from the runtime
  dir, never from the copilot).
- `src/wall/types.ts` — the heartbeat's shape.
- Tests: the override application and the strip-state derivation are pure and unit-tested;
  dragging, fitting, and the visual density are verified by running the wall.
