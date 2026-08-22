## Context

See proposal.md — Why. `emitWallEvents` normalizes each item and appends the accepted ones
to `wall-events.jsonl` in one `appendFileSync`. That is the only place events enter the
log, which is what makes a uniform stamp cheap and reliable.

## Goals / Non-Goals

**Goals:**

- A per-event time that is durable (it lives in the canonical log) and uniform (one writer
  stamps it).
- Old logs keep working unchanged.

**Non-Goals:**

- Backfilling. See D2.
- Timing anything inside the server — dwell, pacing, and the director already have their
  own clock and do not need this field.
- A monotonic or high-resolution clock. This measures human-scale latency in a system
  where a draw takes tens of seconds.

## Decisions

### D1 — Stamped at append, after normalization, not by the producer

The append path is one function and one call; a producer is any of several processes, one
of which is a forked model. Stamping centrally means the field cannot be forgotten, cannot
be forged, and cannot carry a producer's clock skew into a comparison. It also means the
stamp reflects the moment the event became visible to the wall, which is the thing being
measured.

Alternative considered: stamp in the server's `ingest` funnel, next to redaction. Rejected
because the log — not the server's memory — is the canonical rebuild source; a stamp
applied at ingest would vanish on the next replay, which is precisely when it is needed.

### D2 — Absence means unknown, forever, and is never backfilled

Existing logs have no stamp. A backfill would have to invent times, and an invented stamp
is indistinguishable from a real one — it would corrupt the measurement the field exists
to enable, silently and permanently. So the reading rule is part of the contract: unknown,
not zero, not now, not the neighbour's.

### D3 — Named `emittedAt`, deliberately not `ts`

The transcript's `ts` is speech time. A wall event's stamp is emission time. Giving them
the same name invites subtracting one from the other without noticing that the two clocks
mean different things — which is exactly how a latency figure that is not a latency gets
into a report.

## Risks / Trade-offs

- **One more key on every line.** → Negligible against a payload that can carry a whole
  graph; the log is already rotated rather than truncated.
- **A consumer that pattern-matches whole JSON lines could break.** → Nothing in the
  codebase does; the client renders from payload keys and the tests cover replay/resume.
- **Wall-clock, so a system clock change can move it.** → Accepted: the alternative
  (monotonic) is not comparable across processes, and processes are exactly what this
  spans.
