## Why

`wall-events.jsonl` records **what** reached the wall and in what order, but never
**when**. Measured 2026-08-23: a live 86-second session produced four wall events, and
nothing in the log distinguishes an event drawn two seconds after it was spoken from one
drawn forty seconds later.

Two consequences, and the second is the one that matters beyond this change:

- The replay harness cannot compute reaction latency — the headline dimension of a
  product whose entire pitch is that it keeps up with a live conversation.
- **A field report can never be checked against the artifacts.** The wall's most repeated
  field complaint is a box that "stopped refreshing at 20:52:39". Answering that means
  knowing when each event landed, and the canonical log cannot say. The one investigation
  that did answer a timing question had to fall back on the file's mtime, which gives a
  single number for a whole session.

The log is already the canonical rebuild source for accumulated state — it is replayed to
reconstruct graphs, pinned latest, and scroll rings. It is the natural and only place a
per-event time can live durably.

## What Changes

- **Every event appended to `wall-events.jsonl` carries `emittedAt`**, a wall-clock
  millisecond stamp written at append time, after normalization — so a producer cannot
  forge or omit it.
- **`emittedAt` is when the event entered the log**, never when something was said. The
  name is deliberately not `ts`: the transcript's `ts` is speech time, and a reader that
  conflated the two would silently compute nonsense.
- **Absence is tolerated forever.** Every event already in an existing log has no stamp,
  and a consumer must treat that as "unknown", never as zero or as now.

## Capabilities

### Modified Capabilities
- `wall-feed`: the canonical event log gains a per-event emission timestamp, and the
  rules for reading one that lacks it.

## Impact

- **`src/wall/emit.ts`** — the single append point stamps each normalized event.
- **`wall-events.jsonl`** — one extra key per line. Additive: the client renders from
  payload keys and ignores the rest, and replay/resume reconstruct from the same objects.
- **Existing logs keep working**, unstamped. Nothing backfills them; a stamp cannot be
  invented after the fact and a guessed one would be worse than none.
