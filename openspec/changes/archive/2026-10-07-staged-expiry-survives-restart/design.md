# Design

## Context

Every live line reaches the server through the same path: `wall-emit` appends to
`wall-events.jsonl`, and `jsonlTailSource` (`src/wall/event-source.ts`) drains it into
`WallServer.ingest`. On start the tail source drains the whole file first, which is the
canonical rebuild, and then polls for new lines. Today the server cannot tell those two phases
apart. The staging registry stores `Date.now()` at ingest (`src/wall/server.ts:774`, staged
registration after `accumulate`), and the promote gate compares `Date.now()` with it
(`src/wall/server.ts:574`), so a rebuild re-stamps every prediction and re-runs every logged
promote at "now". `promote` lines are appended without `emittedAt` (`src/wall/emit.ts:365`,
promote branch), and `normalizePromote` builds a fresh object that would drop one anyway.
On the display-event path the stamp is lost a second way: `normalizeEvent` copies a field
allowlist (`src/wall/emit.ts:187-202`) and `ingest` replaces the raw line with the normalized
event (`src/wall/server.ts:752`), so the log line's `emittedAt` never reaches the registration
site — the server must capture it from the raw line before normalization (decision below).

## Goals / Non-Goals

**Goals:**

- One time base for the gate: the log's own `emittedAt`, identical live and on replay.
- Fail closed on a log line that cannot show its time, only during the startup replay.

**Non-Goals:**

- Persisting the registry separately; the log stays the single source of truth.
- Changing `wall --reset` (a reset log holds no predictions).

## Decisions

- **Decide by emission time, not by "now".** The registry stores the staged delta's
  `emittedAt`, and the gate evaluates a promote at the promote's `emittedAt`. Live, both are
  stamped at append and so equal the gate's old `Date.now()` to within the tail interval
  (≤ 200 ms), which leaves live behaviour unchanged. On replay they are the original times, so the
  rebuild repeats the live decision exactly. *Alternative considered:* skip every `promote` during
  replay and lose promotions across a restart. Rejected, because a promotion that genuinely
  happened would vanish from the public wall on restart. *Alternative:* record each promote's
  outcome in the log. Rejected, because the outcome is a pure function of two timestamps the log
  can already carry, so a second record could only disagree with them.
- **The server reads the stamp from the raw line, before normalization.** `normalizeEvent`'s
  field allowlist drops `emittedAt` and `ingest` replaces the raw line with the normalized
  event, so the registration site would never see a stamp (found in review). `ingest` therefore
  captures a finite numeric `emittedAt` from the raw message before the reassignment and uses it
  for the staged registration; `normalizePromote` carries the stamp through for the promote
  path. The wire shape is untouched: the SSE display event gains no field, and neither the
  redaction variants nor the `latest`/scroll stores change.
- **Fail closed on a missing stamp, live and replayed alike — no replay signal is needed.** A
  staged delta without a finite numeric `emittedAt` is shown privately but never registered as
  promotable, and a promote without one publishes nothing — whichever way the line reached the
  server. This replaces the earlier plan of signalling "startup replay" through
  `EventSource.start` and keeping a live `Date.now()` fallback: the fallback was the one
  remaining substitution of the current time for a missing stamp, which the wall-feed
  requirement "An event with no emission time is read as unknown" forbids outright. Nothing
  live depends on the fallback — `wall-emit` stamps every line that enters the log, and the
  fake feed emits no staged or promote lines — so the uniform rule costs no live producer
  anything and drops the `EventSource` signature change (no public-API break). A restart can
  now grant nothing: the decisions are a pure function of the stamps the log carries.
- **A stamp that cannot be honest is refused like a missing one.** A promote stamped later
  than the moment it is processed, or earlier than the staged prediction it names, publishes
  nothing and leaves the registry intact — both orderings are impossible for an honest
  appender (the log is ordered, and the append path stamps at write). Beyond these clamps, a
  forged stamp on a line appended directly to the log is inside the documented append-trust
  boundary (`src/wall/types.ts`, the injected-promote note): the clamp raises the bar from
  "any writer" to "a writer willing to forge a plausible timestamp", and `zone: "private"`
  stays the only real content gate.
- **The sweep and the listing stay on the wall clock.** They answer "is it promotable *now*",
  measured against the stored emission time. A rebuilt prediction older than its window is
  therefore swept on the first tick (its private expiry marker goes out once) and never listed.
- **`normalizePromote` carries `emittedAt` through** when it is a finite number, so that the
  server's view of a logged promote keeps its time. The append path still overwrites any
  producer-supplied value, which is what the wall-feed scenario "A producer cannot set its own
  emission time" requires.

## Risks / Trade-offs

- [A clock step on the machine between staging and promote] → the decision follows the stamps,
  which is what a reader of the log would conclude too. A backwards step between append and
  ingest can only make a promote look *earlier than its delta* — refused by the nonsense-stamp
  clamp, i.e. the visual stays private, the fail-safe direction.
- [Old logs lose their promotions on restart] → only lines from before `emittedAt` stamping
  (2026-08-23) are affected, and losing a lift is the safe direction: the visual stays private.
- [A forged future stamp on a staged delta extends its own window] → true, and inside the
  append-trust boundary above; the promote-side clamps still gate the publish, and the sweep
  catches the prediction once real time passes the forged stamp.

## Migration Plan

None. New lines are stamped from the first append after the update; existing stamped logs
replay correctly; unstamped logs degrade to "nothing promotable", as specified.
