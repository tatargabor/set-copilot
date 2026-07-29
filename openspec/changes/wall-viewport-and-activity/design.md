## Context

Four asks that look like separate features share one root: the wall's presentation is fixed
when config is written, and the only way to adapt it is to edit a file and reload — which
is not something an operator does mid-meeting.

Current state:
- Track sizes come from the layout's `columns`/`rows`, or from `rowSize` (`wall-core.mjs:17`)
  when a layout does not declare them. `gridTemplate` (`:36`) derives the CSS Grid template
  once per mount.
- The graph renderer runs `cy.layout({..., fit: true, ...})` (`wall.js:453`) per delta —
  so it fits *when it re-lays-out*, which is the A-path full redraw the spec pins as current
  behavior. There is no fit between layouts and no scale control.
- The heartbeat (`server.ts:337-364`) carries `captureAlive` + `lastHeardMsAgo`, derived
  server-side from the runtime dir. `wall.js:103-112` renders one of three textual states.

The mic/system distinction is the project's load-bearing primitive — CLAUDE.md is explicit
that features should be built on it — and the strip is the one place on the wall where it
is currently invisible.

## Goals / Non-Goals

**Goals:**
- Let the operator adapt the wall to the screen it is on, live, without touching config.
- Make the graph usable as it grows, and give the viewer the final say on scale.
- Surface the mic/system split where the operator already looks.
- Make the wall readable at 1920×1080, its actual deployment size.

**Non-Goals:**
- No layout *editing* from the wall — creating positions, moving boxes, changing
  subscriptions. Composition stays config.
- No multi-screen handling: the operator explicitly cut it (*"maradjunk ennyinél"*).
- No styling configuration surface. Density is a design property, not a knob.
- No new render type, no event-schema change, no zoning or redaction change.

## Decisions

### D1 — A splitter writes a viewport override, and the override is per viewer, not shared

The drag produces an override of the layout's track sizes for that window, stored in the
browser and re-applied on mount. It never travels to the server and never touches config.

Per viewer, because the operator's laptop and the projected wall are different sizes and
different aspect ratios — a shared override would mean adjusting one screen breaks the
other, and the two audiences have genuinely different needs. This also keeps the override
out of the server's state entirely, so it cannot interact with replay, zoning, or the
director.

*Alternative rejected:* a server-side override broadcast to all clients of a window. It
would let the operator fix the projected wall from their own machine — a real benefit — but
at the cost of coupling geometry to the shared event stream and making one viewer's drag a
visible change on a wall in front of an audience. If it is wanted later, it is additive.

### D2 — The override is keyed to the layout it was made against

An override stores which layout id it applies to. A window switched to a different layout
(runtime layout switch already exists) renders that layout's declared proportions, not a
translation of the old override — the tracks are not the same tracks, and guessing a
mapping would produce a geometry nobody chose.

### D3 — Override application is a pure function next to `gridTemplate`

`applyViewportOverride(template, override)` lives in `wall-core.mjs` and is unit-tested:
same-length track lists, a rejected mismatched override (a stale override against a changed
layout), and clamping so a region cannot be dragged to zero. Keeping it pure is what makes
"the override affects geometry only" verifiable rather than asserted — the function has no
access to a box.

### D4 — Auto-fit is a controller with one bit of viewer state, and the viewer wins

The graph render keeps a per-visual flag: fitting is automatic until the viewer sets a
scale, then it is manual until the viewer returns to automatic. A delta arriving while
manual re-renders content without re-fitting.

A `reset` (new `visual` id) starts fitted again. Carrying a scale across a topic change
would apply a choice made for one graph to a different one — the spec has a scenario for
this because it is the case that will feel broken if it is wrong.

Implementation note: because the current renderer is the A-path full redraw (spec: "Render
types"), "keep it fitted" is cheap — the fit already happens per delta; what is missing is
suppressing it under a manual scale and fitting on region resize. A splitter drag resizes
the region, so D1 and D4 meet there: a resize re-fits when automatic, and leaves a manual
scale alone.

### D5 — Per-channel activity is derived server-side, exactly like `lastHeardMsAgo`

The heartbeat gains per-channel ages, computed from the transcript in the runtime dir by
the same code path that computes the existing age — the `speaker` tag is already on every
line, so this is a grouping, not a new source.

Doing it server-side is not a style preference: `wall-liveness`'s invariant is that the
party whose aliveness is in question cannot be the source of the signal. A client-side
derivation would need the transcript, and a copilot-side derivation would reintroduce
exactly the dependency the capability exists to remove.

**Absent vs quiet** is a real distinction and gets its own representation: dictation
(`--mic-only`) never constructs the system client, so a system channel that is merely
missing must not render as a channel that has gone silent — that reading would make a
normal dictation look like a broken meeting capture.

### D6 — The strip becomes visual, and its footprint is part of the density budget

Two small per-channel indicators driven by the per-channel ages, rather than a sentence.
The pure part — `stripState(heartbeat, thresholds)` → per-channel state — goes in
`wall-core.mjs` and is unit-tested; the rendering does not.

The strip competes with content for vertical space on a 1080p screen, so its own height is
counted in the density pass rather than treated as free.

### D7 — Density has a stated reference target and is applied as a pass, not per-component

1920×1080 is the reference (§A5: *"nekem ilyen kis gagyi 1900-as képernyőim vannak"*), and
the pass covers the type scale, spacing rhythm, box padding, and the strip. Both themes.
Judging it means looking at it at that size — so verification is explicit about the screen,
not "looks fine here".

## Risks / Trade-offs

- **A splitter turns into layout editing by accretion.** → The override is track sizes only,
  and D3's pure function has no access to positions or boxes. Adding "move a box" would
  require a different mechanism, visibly.
- **A stale override against a changed layout produces a broken grid.** → D2 keys the
  override to a layout id and D3 rejects a mismatch, falling back to declared proportions.
- **A dragged region collapses to zero and its content becomes unreachable.** → Clamped in
  D3, with the clamp unit-tested.
- **Per-viewer overrides mean the projected wall cannot be fixed from the operator's
  machine.** → Accepted (D1), with the server-side variant recorded as the additive
  follow-up if the field asks for it.
- **Auto-fit fights a viewer who is mid-inspection.** → That is precisely what the manual
  bit exists for; the risk is the reverse (a manual scale silently persisting into a new
  topic), which D4's reset behavior handles.
- **The density pass is subjective and can churn.** → One stated reference size, one pass,
  verified at that size; not a per-component negotiation.

## Migration Plan

Additive on the wire and in config: the heartbeat gains fields an older client ignores, and
no config key changes. Viewport overrides live in the browser, so there is nothing to
migrate and clearing them is a local action. Rollback is a revert.

## Open Questions

- ~~Where the "reset to declared proportions" and "return to auto-fit" affordances live.~~
  **Decided at apply time, and they landed in different places on purpose.** *Reset
  proportions* is in the **status strip**, plus a double-click on any boundary: the strip is
  the one piece of furniture guaranteed to exist in every window and every layout (the same
  reason the liveness status lives there), so a layout that fills every position cannot hide
  the escape hatch. It is hidden until an override exists. *Return to auto-fit* is a button
  **in the graph pane itself**, because it is per-visual state — a strip control would have to
  name which box it meant. No keyboard shortcut: the wall is a display, and the one machine
  with a keyboard in front of it is the one that already has the mouse.
- Whether the per-channel indicator should show a level (amplitude) rather than recency.
  Recency is what the heartbeat can honestly derive from the transcript; a level would need
  a new signal from capture. Out of scope, worth recording.
