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
### Requirement: Stateful incremental graph delta

The graph worker SHALL own the accumulated graph state for its category and emit only the
delta (new nodes/edges) for each update, rather than re-emitting the whole graph. It SHALL NOT
re-add nodes or edges already present in its accumulated state, so the client renders an
incremental append (Graphiti-style), never a full redraw.

#### Scenario: Only new elements are emitted

- **WHEN** the worker has already emitted nodes A and B, and the transcript now implies node C
  connected to B
- **THEN** the worker emits a delta adding only C and the B→C edge, not A or B again

#### Scenario: Worker holds state in memory across ticks

- **WHEN** the worker produces several deltas over the session
- **THEN** it tracks the accumulated graph in process memory and does not require the state to
  be re-passed on each invocation

### Requirement: Single structured output, streamed to cut time-to-first-token

Each graph update SHALL be a single structured-output model call (JSON node/edge delta). The
worker MAY stream the model response internally to cut time-to-first-token, but it SHALL emit
the delta to the event source as one complete category-tagged JSON line — the ingest transport
is JSONL append-and-tail (per `monitor-wall-display` D7), so a partial line is never
broadcast. The worker SHALL NOT use a multi-turn tool loop in the hot path; any grounding
context is pre-loaded into the prompt, not fetched via in-loop tool calls.

#### Scenario: No multi-turn tool loop per update

- **WHEN** the worker computes a delta
- **THEN** it issues one structured-output call (no intermediate tool round-trips); it MAY
  stream the model response internally to reduce latency, and emits the finished delta as one
  complete JSON line to the event source (never a partial line, since the server tails
  whole lines)

### Requirement: Model choice defaults to the fast tier

The graph worker SHALL default to the fast model tier (Claude Haiku) for its delta calls.
A slower, stronger model (e.g. Sonnet) SHALL be used only when configured because delta
quality on the fast tier is insufficient — the default optimizes for the live latency budget.

#### Scenario: Default uses Haiku

- **WHEN** the worker starts with no model override
- **THEN** it uses the fast tier (Haiku) for delta extraction

#### Scenario: Stronger model is opt-in

- **WHEN** the config selects a stronger model for the worker
- **THEN** the worker uses it, accepting the higher latency as a deliberate quality trade-off

### Requirement: Cacheable stable prefix

The worker SHALL structure its prompt so the stable prefix (system prompt + knowledge context
+ accumulated graph) is prompt-cacheable, and the volatile suffix (the newest transcript span)
follows it, to minimize time-to-first-token and cost across the many calls of a long session.

#### Scenario: Stable prefix is reused across calls

- **WHEN** the worker makes successive delta calls within a session
- **THEN** the stable prefix is arranged to hit the prompt cache, and only the newest
  transcript span varies between calls

### Requirement: Direct-to-hub emission

The worker SHALL push its deltas straight to the wall's event-source ingest, not back through
the main session. The main session SHALL NOT be on the critical path of a graph delta.

#### Scenario: Delta reaches the hub without the main session

- **WHEN** the worker produces a delta
- **THEN** it emits directly to the event-source ingest, and the delta appears on the wall
  without a round-trip through the main Claude session

