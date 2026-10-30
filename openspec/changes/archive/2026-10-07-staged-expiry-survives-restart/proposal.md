# Proposal

## Why

A wall restart rebuilds its state by replaying the whole event log, and during that replay
the staging gate loses its clock. A staged prediction is registered with the time of the
*rebuild*, so an expired guess becomes promotable again for another full window. A `promote`
line in the log is executed again. A promotion that was refused live because the prediction
had expired now succeeds, and the guess reaches the public wall long after the conversation
moved on. That is exactly the "an unspoken guess publishes late and out of context" failure
the expiry exists to prevent, and the invariant "a prediction never reaches a public client
automatically" with it: here nobody issued a new promote at all.

Found by the 2026-10-03 drift audit (`retro-spec-drift`, suspected regression #1).

## What Changes

- The promote gate and the expiry window are decided by **emission time**, the time a line
  entered the log, on replay as well as live. A staged prediction's window runs from its
  delta's `emittedAt`, and a promote is judged at its own emission time. A rebuild therefore
  reaches the same promote decisions the live wall reached.
- `promote` lines are stamped with `emittedAt` by the append path, like display events.
  `pending` and `layout` stay unstamped.
- **Fail closed on a line that cannot show its time, replayed or live.** A staged delta with no
  `emittedAt` does not enter the promotable registry (it is still shown privately), and a
  `promote` with no `emittedAt` publishes nothing — whichever way the line reached the server.
  An unstamped line can no longer prove it was live, and the safe reading of an unknown is
  "not promotable". This also removes the gate's one substitution of the current time for a
  missing stamp, which the `wall-feed` requirement "An event with no emission time is read as
  unknown" forbids; no live producer depends on that substitution (`wall-emit` stamps
  everything that enters the log, and the fake feed emits no staged or promote lines).
- Live behaviour does not change: a fresh delta or promote is stamped at append time, which is
  the same instant the gate used to read from its own clock.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `predictive-staging`: "An unused prediction expires quietly" gains the restart rule; the
  expiry window and promote decision are measured in emission time.
- `wall-feed`: "Every appended event records when it was emitted" now also stamps `promote`
  control lines; `pending` and `layout` stay unstamped.

## Impact

- `src/wall/emit.ts`: stamp `promote` on append.
- `src/wall/emit.ts` (`normalizePromote`) and `src/wall/server.ts` (staging registry, promote
  gate): carry and use `emittedAt`. `ingest` reads the stamp from the raw log line before
  `normalizeEvent` replaces the message (the normalized event's field allowlist drops it), so
  the wire shape is untouched.
- Tests: `src/wall/server.staging.test.ts`, `src/wall/emit.test.ts`.
- No config change. The `wall-staged` listing keeps its contract; it now reports a lifetime
  measured from emission instead of from ingest, which only differs on a rebuilt wall.
