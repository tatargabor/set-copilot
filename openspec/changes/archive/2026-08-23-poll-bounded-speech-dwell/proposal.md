## Why

The copilot's measured reaction latency is ~34 s. Almost none of it is thinking.

Measured 2026-08-23 on a real-time run of the `reference` scenario: from a planted moment
to the **next silence event** is 30.7 s on average. The poll returns early only on an
urgent line, a question, a direct address, or a silence — so during continuous speech a
line simply **is not shown to the copilot** for half a minute. The model reacts promptly
once it sees the line; it is the gate that is slow.

That gate is right for the case it was written for. A presentation is the case it was not:
a presenter speaks in a near-continuous stream, and the thing most worth flagging — a
figure that contradicts their own slide — is neither urgent, nor a question, nor addressed
to anyone. It waits for a pause that may be a minute away.

## What Changes

- **A poll returns once enough new speech has accumulated**, not only on a trigger. Speech
  lines are complete sentences already (the writer flushes on `. ? !`), so a batch of them
  is coherent without waiting for a pause to confirm it.
- **The threshold is config**, because it is a cost/latency trade the operator owns: every
  extra return is a model turn. `copilot.pollDwell` sets how many new speech lines end a
  poll; `0` restores exactly today's behaviour.
- **Nothing else about the poll changes** — the existing early-return triggers, the
  filtering, the offset bookkeeping, and the end-of-capture drain are untouched.

## Capabilities

### Modified Capabilities
- `transcript-poll`: a poll gains a second reason to return — accumulated speech — and the
  rules that keep it from firing on non-speech or on an empty batch.

## Impact

- **`src/poll.ts`** — one more condition inside the existing pure `pollDecision`.
- **`src/config.ts`** — a `copilot.pollDwell` key.
- **Cost**: more, shorter turns. Deliberate and configurable; the default is chosen to
  roughly halve the measured wait rather than to minimise it.
- **Measurable**: the replay harness declares a latency noise band of ±2244 ms for this
  scenario, so a change of this size is evidence rather than a reading.
