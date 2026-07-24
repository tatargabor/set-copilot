## Why

The chat↔wall feedback contract — chat is the copilot's primary voice (liveness, acknowledgement,
interpretation) and the wall a secondary visual artifact — is already implemented and tested in the
code, but has no applied spec. This change records the shipped behavior as a spec so the applied
specs match the code. It is split out of `wall-feedback-and-replay`, whose replay half remains
unbuilt and stays a separate, live change.

Shipped foundation this records: `copilot.acknowledge` (`src/config.ts:65`, default at `:447`,
`!== false` guard at `:577`), the `renderFeedback()` "## Feedback" block
(`src/copilot-prompt.ts:74-88`), the Phase-5 chat-primary policy in
`skills/meeting-copilot/SKILL.md`, and tests at `src/config.test.ts:68-71` and
`src/copilot-prompt.test.ts:37-45`.

## What Changes

- **New capability `wall-feedback`** captures the already-shipped contract: chat is the primary
  feedback channel and the wall a secondary artifact; a wall visual is mirrored by a brief chat
  acknowledgement; direct address is never met with silence; the acknowledgement amount is
  config-driven via `copilot.acknowledge` and does not change the multi-party category-firing
  policy; an ambiguous interpretation is flagged/asked in chat, not asserted on the wall.
- No code change — this is an archive of shipped behavior, recorded so the spec catches up to the
  code.

## Capabilities

### New Capabilities

- `wall-feedback`: the chat↔wall feedback contract — chat primary (liveness, acknowledgement,
  interpretation), wall secondary; uncertain interpretation is a chat question, not a wall fact.

### Modified Capabilities

<!-- none -->

## Impact

- **Spec-only.** No `src/`, test, or build change — the behavior already ships. Archiving creates
  `openspec/specs/wall-feedback/spec.md`.
- Split from `wall-feedback-and-replay`: that change keeps only the unbuilt replay work
  (scroll-history) and the operational/verification/docs debts.
