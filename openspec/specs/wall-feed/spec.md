# wall-feed Specification

## Purpose

How real content reaches the monitor wall: the producer side of the `wall-emit` ingest
seam that `monitor-wall-display` opened. It governs how producers are partitioned (by
output modality, one mandate each), that no producer may block another, that the text
path stays free of any model hop, and what latency the whole path must meet.

The producer itself is a fork of the main session — see `fork-producer`. This capability
covers the feed's *shape and budget*; `fork-producer` covers what a producer is.
## Requirements
### Requirement: Modality-partitioned parallel producers

The feed SHALL be composed of independent producers partitioned by output modality, each
running concurrently and each emitting its category-tagged events to the wall's
producer-agnostic event source (the `monitor-wall-display` ingest seam). A slow producer
SHALL NOT block a fast one (no head-of-line blocking): each producer emits when its own data
is ready. Producers SHALL NOT write directly to the SSE broadcast; they SHALL go through the
event-source ingest so the server-side director stays authoritative.

Each producer SHALL be a fork of the main session scoped to a single slot mandate (see
`fork-producer`). Concurrency is therefore per-slot fork concurrency, not a fleet of
independently-running worker processes.

#### Scenario: A slow graph update does not delay an alert

- **WHEN** a graph producer fork is mid-computation on an expensive delta and a text producer
  determines an alert is ready
- **THEN** the alert is ingested and broadcast without waiting for the graph delta to finish

#### Scenario: Producer output is byte-compatible with the fake-feed

- **WHEN** the real producers replace the scripted fake-feed
- **THEN** they emit the same category-tagged event shape (per `monitor-wall-display` D6), so
  the display renders them with no change to the server core, SSE, director, or client render

#### Scenario: Concurrent slot forks do not block each other

- **WHEN** two slot mandates warrant an update at the same time
- **THEN** two forks run concurrently and each emits independently as soon as its own output
  is ready

#### Scenario: Text reaches the wall within the render-hop budget

- **WHEN** the main session (or a thin text loop) has a súgás/riasztás ready
- **THEN** it is emitted directly to the event source with no intermediate LLM call, and the
  added latency over in-session output is the SSE + render hop only

#### Scenario: Alert bypasses the director's pacing

- **WHEN** a `riasztás` event is emitted with `priority: "immediate"`
- **THEN** the server-side director broadcasts it immediately without applying dwell/freshness
  pacing (pacing applies only to the paced canvas swap)

### Requirement: Text path carries no model hop

Text-modality categories (transcript, súgás, riasztás) SHALL be produced without an
intermediate model round-trip. The text producer SHALL read the live transcript (via the
existing line-offset long-poll) and emit category events directly, so the only latency added
over today's in-session output is the render hop. A model SHALL NOT be inserted into the text
path.

#### Scenario: Text reaches the wall within the render-hop budget

- **WHEN** the main session (or a thin text loop) has a súgás/riasztás ready
- **THEN** it is emitted directly to the event source with no intermediate LLM call, and the
  added latency over in-session output is the SSE + render hop only

#### Scenario: Alert bypasses the director's pacing

- **WHEN** a `riasztás` event is emitted with `priority: "immediate"`
- **THEN** the server-side director broadcasts it immediately without applying dwell/freshness
  pacing (pacing applies only to the paced canvas swap)

### Requirement: Latency budget

The feed SHALL meet a per-modality latency budget. The text path SHALL add only the render hop
(single/double-digit milliseconds locally) over in-session output.

The graph path budget SHALL be established by live measurement on the fork producer, not
inherited from the fast-tier research estimate. Because a producer fork runs on the parent
session's model (see `fork-producer`), the previously specified 1–4 second small-model delta
budget is not applicable and SHALL NOT be asserted without a recorded measurement.

The governing user-facing property SHALL be that the main session is not blocked while a
visual is produced: perceived responsiveness in chat SHALL NOT degrade when a fork is drawing.

#### Scenario: Graph budget comes from measurement

- **WHEN** the graph path latency is stated
- **THEN** it cites a recorded live measurement of the fork producer, not the fast-tier research
  estimate

#### Scenario: Drawing does not stall the chat

- **WHEN** a producer fork is drawing a visual
- **THEN** the main session continues to respond in chat without waiting for the fork

#### Scenario: Graph delta beats main-model rendering

- **WHEN** a diagram update is needed
- **THEN** the producer emits a compact structured spec (nodes/edges via `wall-emit`) that the
  client renders deterministically (~10 ms), rather than the main session generating the full
  visual inline (seconds), and the fork runs in parallel with the chat so it never delays text
  output. The magnitude of the fork's own latency is not asserted here — it is deferred to
  measurement (see "Graph budget comes from measurement").

### Requirement: Speaker and zone primitives preserved

Producers SHALL consume the existing `speaker` (`mic` | `system`) and `zone`
(`private` | `public` | `both`) primitives rather than inventing a new capture or routing
path. Voice command scoping SHALL remain restricted to `mic`.

#### Scenario: A producer preserves speaker attribution

- **WHEN** a text producer emits a `transzkript` event derived from a `system`-tagged
  transcript line
- **THEN** the emitted event carries `speaker: "system"` so the display keeps the én/mindenki
  más distinction

