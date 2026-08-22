## Context

See proposal.md — Why. `runPoll` loops on a 250 ms tick: it checks capture liveness, then
reads the transcript, filters the new lines, and returns either on an early-return trigger
or at the end of its wait. The liveness check `return`s before the read, which is the
defect.

## Goals / Non-Goals

**Goals:**

- No line is lost because the capture happened to exit before the consumer's next poll.
- `capture-dead` keeps meaning what every consumer already assumes it means, so no skill
  changes.

**Non-Goals:**

- Changing what ends a poll early, what a batch is filtered by, or the offset format.
- Making `capture-dead` carry data. It is a terminator; overloading it would push parsing
  work onto every consumer for no gain.

## Decisions

### D1 — Drain through the existing batch path, not a special one

The dead-capture drain reuses the same read, the same filter, and the same offset write a
live batch uses. A separate "final read" would be a second place where "which lines has
this consumer seen" is decided, and the offset is exactly the kind of state that must have
one writer — the harness this was found with exists because a second implementation of a
rule is how the first one's fix gets lost.

### D2 — Death is reported on the poll after the drain, not appended to it

A drained batch ends the poll normally; the next poll reports `capture-dead`. The
alternative — emitting the lines and the notice together — would make `capture-dead` a
line that can be preceded by content in the same response, and every consumer's parsing
assumption about a terminator would have to be re-checked. One extra round trip at the end
of a meeting is not worth that.

This also keeps the notice honest: it is emitted when there is genuinely nothing left,
rather than as a prediction that nothing more will come.

### D3 — The liveness check stays first in the loop

Only its *action* changes: from "return" to "drain, then return". Keeping the check at the
top preserves the existing tick behaviour and means a capture that dies mid-wait is noticed
within one tick, as before.

## Risks / Trade-offs

- **A consumer that treated `capture-dead` as "nothing more will ever arrive" now receives
  content before it.** → It always could in principle; the sequence was simply unreachable.
  The shipped skills poll in a loop and handle a batch followed by a terminator, so this is
  the case they were already written for.
- **One extra poll round trip at the end of a capture.** → Accepted, per D2. The cost is a
  single tick at the end of a meeting.
- **A very large unread tail is delivered in one batch.** → This is the existing behaviour
  for a live capture after a long gap; nothing new, and the alternative is losing it.
