# graph-worker Specification

## Purpose

**Retired.** This capability specified an autonomous, stateful, fast-tier (Haiku) worker
that watched the transcript and emitted graph deltas on its own. It was built as a
prototype and it worked mechanically — real graph, correct chart — but without grounding
or intent it over-captured, producing a 47-node hairball with people and side threads as
nodes (`wall-producers` D9).

Two successive changes walked it back: `wall-producers` D9 demoted it to an optional
offload, and `fork-wall-producer` removed it entirely. The producer is now a fork of the
main session, which inherits the chat's context and therefore its grounding — see
`fork-producer`, and `wall-feed` for the feed's shape and latency budget.

The requirements below were removed rather than edited, each with its reason, so the
decision leaves a trace. Kept as a tombstone: the failure it records is the kind a later
iteration would otherwise rebuild.
## Requirements
### Requirement: Graph production is a fork-producer responsibility

Graph visuals SHALL be produced by a fork of the main session (see `fork-producer`), not by a
standalone graph-worker process. This capability retains no independent worker requirements of
its own: its former requirements are removed below, each with a migration pointer to
`fork-producer` (grounding, emission, model tier) or to the server-side accumulation in
`wall-feed`/`monitor-wall-display` (incremental state). This requirement remains as the explicit
record that graph production did not vanish — it moved to the fork producer.

#### Scenario: A graph visual is produced by a fork, not a standalone worker

- **WHEN** the wall needs a graph visual
- **THEN** a fork of the main session composes and emits it through the `wall-emit` seam, and no
  standalone graph-worker process is involved

