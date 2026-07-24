# Tasks

This change is spec-text only — no `src/`, no tests, no build. Each requirement edit already
lives in a delta spec under `specs/`; the tasks below are verification and the post-archive
Purpose fills.

## 1. wall-feed delta

- [x] 1.1 `transcript`/`transzkript` removed from "Text path carries no model hop" and its
  scenario retargeted onto a real category (`riasztás`), matching `config.ts:296-309`
- [x] 1.2 Latency claim corrected in "Modality-partitioned parallel producers",
  "Text path carries no model hop", and "Latency budget" to name the ingest hop (append +
  tail-poll + spawn + SSE/render), sub-ms confined to the in-process fake-feed
- [x] 1.3 All base scenarios carried forward (none dropped) — archiver invariant

## 2. display-layout delta

- [x] 2.1 "Render types" graph mandate rewritten to the shipped A-path full redraw
  (`wall.js:277-288`), with incremental `cy.add` kept as tracked future (task 9.13)
- [x] 2.2 "Incremental graph append" scenario body rewritten in place (header kept, per the
  archiver's no-scenario-rename rule) to reflect the shipped full redraw + the 9.13 note
- [x] 2.3 "Slot-based layout composition" composition scenario positions corrected
  `left`/`right` → `szöveg`/`prezentáció` (the shipped `third-two-thirds` positions)
- [x] 2.4 All base scenarios carried forward, legacy `slots` scenarios intact

## 3. box-policy delta

- [x] 3.1 "A box's mandate is independent of its zone" reworded so zone is a window-level
  property (`WallWindow.zones`); mandate stays `WallBox.policy`; independence preserved
- [x] 3.2 Both scenarios retargeted to change the *window's* zone, none dropped

## 4. Validate

- [x] 4.1 `openspec validate spec-sync-corrections --strict` passes
- [x] 4.2 Re-read each delta against its cited source lines to confirm the spec now matches code

## 5. Post-archive Purpose fills (direct edits to applied specs)

- [x] 5.1 `openspec/specs/box-policy/spec.md` — replace `Purpose: TBD` with a real one-liner
- [x] 5.2 `openspec/specs/display-layout/spec.md` — replace `Purpose: TBD` with a real one-liner
- [x] 5.3 `openspec/specs/fork-producer/spec.md` — replace `Purpose: TBD` with a real one-liner
