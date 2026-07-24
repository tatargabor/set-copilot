## Context

An adversarial, per-capability audit compared all seven applied specs against `src/`. Five
(`wall-server`, `display-categories`, `fork-producer`, `graph-worker`, and behaviorally
`box-policy`) match the code. Three carry requirement text that contradicts what ships:

- `wall-feed` names a `transcript`/`transzkript` text category; the registry deliberately has
  none (`config.ts:296-309`), so such an event is unrenderable.
- `display-layout` mandates incremental `cy.add` graph rendering "not a full rebuild"; the client
  ships the A-path full redraw (`wall.js:277-288`) — an intentional prototype, already tracked as
  the open task 9.13 (`design.md:208` of the archived `wall-layout-and-box-policy` change).
- `box-policy` models a box's *zone* as a box property; zone is window-level (`WallWindow.zones`).

Plus a cosmetic gap: `box-policy`, `display-layout`, and `fork-producer` still carry the
placeholder `Purpose: TBD — Update Purpose after archive`.

## Goals / Non-Goals

**Goals**
- Make the three drifting specs describe the code that actually ships, so the six pending
  wall/copilot changes rebase on an accurate base.
- Fill the three placeholder Purpose lines.

**Non-Goals**
- No `src/` change, no test change, no runtime behavior change. This is a documentation-accuracy
  sync, not a feature.
- Not implementing incremental graph rendering (B-path): that stays task 9.13. The user chose to
  sync the *spec to the code*, not the code to the spec.

## Decisions

- **Graph drift → spec follows code (A-path), not code follows spec.** Alternative considered:
  implement incremental `cy.add` to satisfy the existing requirement. Rejected for this change —
  the full redraw is a deliberate, documented prototype step (comment at `wall.js:285-287`), the
  graphs are demo-scale so the redraw is functionally fine, and the incremental path is already an
  open, tracked item (9.13). The spec now states A-path as current behavior and names B-path as the
  tracked future, so the spec stops over-claiming without deleting the intent.

- **`transcript` category removed from spec, not added to code.** The absence is intentional and
  commented (`config.ts:296-298`, `feed-script.ts:6-7`). The spec is the thing that is wrong.

- **Latency wording corrected to the real out-of-process path.** The "SSE + render hop only /
  single-digit ms" claim ignored the JSONL tail-poll interval and the `wall-emit` process spawn.
  The corrected text names the full ingest hop and confines the sub-ms figure to the in-process
  fake-feed. No numeric budget is invented — the correction only stops understating the path.

- **Zone reworded as window-level; independence preserved.** The requirement's normative content
  (mandate ⟂ zone) was already true in code; only the "a box's zone" mental model was wrong. The
  reword attaches zone to `WallWindow.zones` and keeps both scenarios, retargeted to change the
  *window's* zone.

- **Purpose lines filled by direct edit after archive, not via delta.** Purpose is not a
  requirement and does not flow through the `## MODIFIED Requirements` delta mechanism; each spec's
  own note says "Update Purpose after archive." So the tasks do the Purpose edits as a final step,
  directly on the applied `openspec/specs/*` files, after the requirement deltas have been synced
  and archived.

## Risks / Trade-offs

- **Pending changes authored against the old text** → This change archives first; whichever of the
  six pending changes later MODIFIEs one of these same requirements must copy the corrected base
  block (standard OpenSpec dependency order). Flagged in the proposal's Impact.
- **Archive scenario-drop guard** → Every MODIFIED requirement here carries forward all of its base
  scenarios (edited in place, none dropped), satisfying the archiver invariant. The legacy `slots`
  scenarios keep their arbitrary `transzkript` cat on purpose — they illustrate back-compat with old
  configs, not the current registry.

## Migration Plan

1. Apply: the change is spec-text only; there is nothing to build or test. Verify with
   `openspec validate` and a re-read of the three delta specs against the cited source lines.
2. Archive (`/opsx:archive`), syncing the three delta specs into `openspec/specs/`.
3. Fill the three `Purpose:` lines directly in the applied specs (post-archive, per convention).
4. Optional follow-up (separate commit, out of this change's scope): the pure code-comment nits —
   the stale "graph worker later" comment (`event-source.ts:4`) and the unused
   `resolveEventCategory` (`routing.ts:37`).

## Open Questions

None. Direction (spec→code) and workflow (OpenSpec change) were both decided before authoring.
