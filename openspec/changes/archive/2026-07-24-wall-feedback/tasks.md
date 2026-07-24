# Tasks

This change records already-shipped, already-tested behavior as a spec. All implementation tasks
are complete (verified against source); archiving syncs the delta into `openspec/specs/`.

## 1. Chat↔wall feedback model (shipped)

- [x] 1.1 `meeting-copilot/SKILL.md` Phase 5: chat is the primary voice, the wall the secondary
  artifact; a wall visual is accompanied by a brief chat line stating what was understood
- [x] 1.2 Direct address is never met with silence: narrow feedback opening (direct address +
  acknowledging own wall emissions) without changing the multi-party category-firing policy
- [x] 1.3 Config seam `copilot.acknowledge` (boolean, default on), orthogonal to `engagement`,
  rendered as a `## Feedback` block by `set-copilot prompt` (`src/copilot-prompt.ts:74-88`)
- [x] 1.4 Ambiguous interpretation flagged/asked in chat, not asserted on the wall (D2)

## 2. Verify

- [x] 2.1 Behavior confirmed against source (`config.ts:65,447,577`; `copilot-prompt.ts:74-88`) and
  tests (`config.test.ts:68-71`, `copilot-prompt.test.ts:37-45`)
- [x] 2.2 `openspec validate wall-feedback --strict` passes
