## Why

An adversarial spec-vs-code audit of the seven applied specs found them mostly faithful,
but three carry requirement text that contradicts the shipped code: `wall-feed` names a
`transcript` text category the engine deliberately does not have, `display-layout` mandates
incremental graph rendering the client does not do (it ships the A-path full rebuild), and
`box-policy` models a box's *zone* as a box property when zone is window-level. Three specs
also still carry a placeholder `Purpose: TBD` line. This is a documentation-accuracy sync —
no behavior changes — done now so the six pending wall/copilot changes rebase on an
accurate base rather than propagating the drift.

## What Changes

Spec-only. No `src/` change, no test change, no runtime behavior change.

- **wall-feed** — Remove the phantom `transcript`/`transzkript` text category. The registry
  deliberately has no raw-transcript category (`config.ts:296-309`: *"there is deliberately
  no raw transcript category"*), so an event tagged `transcript` is never renderable. The
  "Text path carries no model hop" requirement drops `transcript` from its category list, and
  the "Speaker and zone primitives preserved" scenario is retargeted off `transzkript` onto a
  real category. The latency-budget claim is tightened: the real out-of-process text path adds
  the ~200 ms JSONL tail-poll (`event-source.ts`) and the `wall-emit` process spawn, not just
  "the SSE + render hop" — only the in-process fake-feed hits the sub-ms figure.
- **display-layout** — Retarget the "Render types" requirement's incremental-graph mandate to
  the shipped **A-path** reality: the `graph` renderer rebuilds the accumulated node/edge set
  on each `add` delta (`wall.js:277-288`), an intentional prototype step. Incremental `cy.add`
  stays the documented target, tracked as the still-open task 9.13 — not asserted as current
  behavior. The composition scenario's illustrative positions `left`/`right` are corrected to
  the shipped `third-two-thirds` positions `szöveg`/`prezentáció`.
- **box-policy** — Clarify that a box's *zone* is a **window-level** property (`WallWindow.zones`),
  while its *mandate* is box-level (`WallBox.policy`). The normative independence claim is
  unchanged; only the mental model ("a box's zone") is corrected to match the code.
- **Purpose lines** — Fill the placeholder `Purpose: TBD` in `box-policy`, `display-layout`, and
  `fork-producer` with a real one-line purpose (direct edits to the applied specs after archive,
  per each spec's own "Update Purpose after archive" note — Purpose is not a requirement and does
  not flow through the delta mechanism).

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `wall-feed`: "Text path carries no model hop" drops the `transcript` category; "Speaker and
  zone primitives preserved" scenario retargeted off `transzkript`; "Latency budget" wording
  corrected to account for the tail-poll + emit-spawn on the real path.
- `display-layout`: "Render types" incremental-graph mandate corrected to the shipped A-path
  full-rebuild (incremental kept as tracked future); "Slot-based layout composition" scenario
  positions corrected `left`/`right` → `szöveg`/`prezentáció`.
- `box-policy`: "A box's mandate is independent of its zone" reworded so zone is a window-level
  property; independence claim preserved.

(`fork-producer` receives only a Purpose-line fill — not a requirement change — so it has no
delta spec.)

## Impact

- **Docs/specs only** — `openspec/specs/{wall-feed,display-layout,box-policy}/spec.md` requirement
  text; Purpose lines in those plus `fork-producer`. No `src/`, no tests, no build.
- **Ordering** — Archive this change **before** applying the six pending wall/copilot changes
  (`wall-public-redaction`, `wall-liveness-feedback`, `wall-feedback-and-replay`,
  `wall-predictive-staging`, `live-narration-box`, `copilot-transcript-persistence`). Those were
  authored against the pre-sync text; whichever later modifies these same requirements must rebase
  on the corrected base (standard delta dependency order).
- **No dependency inversion** — this change only MODIFIEs requirements already ADDED by archived
  changes, so its own archive has no unmet prerequisite.
