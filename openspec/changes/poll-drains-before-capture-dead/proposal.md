## Why

`poll` reports a dead capture **before** it reads the transcript, so every line written
between the consumer's previous poll and the capture's exit is never delivered. The lines
are on disk; the copilot simply never sees them.

Measured 2026-08-23 with the replay harness: a 5-line transcript, `poll-offset` at 0, the
capture already exited — the consumer received `{"type":"capture-dead"}` and **zero lines**.
In a real-time run of the same scenario the last two utterances were lost the same way, one
of which was the scenario's planted contradiction.

In a live meeting this is the closing minutes: a capture that hits `--max-minutes`, or a
`stop` at the end of the call, silently truncates the copilot's view of the conversation
exactly where decisions are made. The transcript file is intact, so nothing is *lost* — but
the copilot never reacts to it, and nobody can tell, because a dead capture and a quiet one
produce the same silence.

The bug predates the harness; the harness is what made it observable, because it is the
first way to stop a capture while knowing precisely which lines were still unread.

## What Changes

- **`poll` drains before it reports death.** When the capture is gone, the remaining
  unread lines are returned first — filtered and offset-advanced exactly as a normal batch
  — and `capture-dead` is reported once there is nothing left to hand over.
- **`capture-dead` keeps its meaning**: the capture is gone and the transcript is fully
  consumed. A consumer's loop-termination logic is unaffected, because the signal still
  arrives; it now arrives *after* the content rather than instead of it.
- No new flag, no configuration. A consumer that was losing lines starts receiving them.

## Capabilities

### New Capabilities
- `transcript-poll`: the long-poll contract between a capture and its consumer — what a
  batch contains, what ends a poll early, and what happens at the end of a capture. The
  behaviour exists and ships today; it has never had a spec, which is part of why this
  defect survived.

### Modified Capabilities
<!-- None: `poll` has no existing spec to modify. -->

## Impact

- **`src/poll.ts`** — the liveness check moves from "return immediately" to "drain, then
  return". The offset bookkeeping is the one already used for a normal batch, so a drained
  batch cannot be delivered twice.
- **Consumers** (`meeting-copilot` and the `/ds`–`/dd` skills) need no change. They already
  handle a batch followed by `capture-dead`; that sequence simply used to be unreachable.
- **The replay harness** gains the ability to score a scenario's final utterances, which it
  structurally could not before.
