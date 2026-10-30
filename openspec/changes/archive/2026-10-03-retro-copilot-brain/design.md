# Design

## Context

See proposal.md — Why. The behaviour already exists; this change only writes it down. The
specs were derived by reading `src/knowledge/*.ts`, `src/copilot-prompt.ts`, the `knowledge.*` and
`copilot.*` resolution in `src/config.ts`, `src/replay-{scenario,score,judge}.ts`, their tests, and
the commits that introduced each behaviour (d755ea8, 76da61c, 91723f6, c170570, 5530090, c3383cb,
f6f64da, a5bebb8).

## Goals / Non-Goals

**Goals:**
- Every requirement is observable in the current code and pinned to a file and line in tasks.md.
- Requirements carry the measured reason that produced them, so a later change sees what it would undo.

**Non-Goals:**
- No behaviour change, no bug fix, no test addition. Where the code looked surprising, the spec
  records what it does, not what it arguably should do.
- Not re-specifying what other capabilities already own.

## Decisions

- **Two new capabilities, not one.** The digest (what the copilot knows) and the policy (how it
  behaves) are separate commands with separate consumers — the capture reads the keyword index,
  the skill reads the policy — so they are `knowledge-digest` and `copilot-policy`.
- **Reference, don't duplicate.** The policy renderer also emits the narration, mirroring,
  feedback, wall-input, per-box and promotion text. Those are already specified in
  `live-narration`, `chat-mirror`, `wall-feedback`, `wall-input`, `box-policy`, `fork-producer` and
  `predictive-staging`; `copilot-policy` specifies only the composition rule (order, gating,
  append-only) and names those specs. The fast-lane mechanism belongs to the capture side; only the
  policy text that teaches it is specified here.
- **The noise band is declared, not computed.** The census said "a measured noiseBand from N runs,
  rounded up". The code computes nothing: the band is a value in the scenario meta that `compare`
  reads via `--scenario`. Rounding up and "N=3 is a lower bound" are the documented measuring
  convention (CLAUDE.md, docs/replay-harness.md), so the spec states them as convention and makes
  the normative part "applied as declared".
- **The deck's slide-keyword rule lands in `deck-knowledge` as ADDED**, not as a MODIFIED version of
  "Slides reach the copilot through the existing knowledge pipeline": the base requirement is
  still true, and the new rules add detail without contradicting it.
- **The comparison requirement is MODIFIED**, because the noise band changes what "unchanged"
  means there; both base scenarios are carried forward verbatim.

## Risks / Trade-offs

- [A retro-spec freezes current quirks as contract — e.g. an empty `deferredMarkers` list falls
  back to the defaults instead of meaning "none"] → recorded as-is; changing it is a future change
  with its own proposal.
- [Line references in tasks.md go stale as code moves] → they are verification evidence for this
  change at archive time, not a maintained index.
