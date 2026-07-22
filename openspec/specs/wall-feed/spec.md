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

#### Scenario: A slow graph update does not delay an alert

- **WHEN** a graph producer is mid-computation on an expensive delta and a text producer
  determines an alert is ready
- **THEN** the alert is ingested and broadcast without waiting for the graph delta to finish

#### Scenario: Producer output is byte-compatible with the fake-feed

- **WHEN** the real producers replace the scripted fake-feed
- **THEN** they emit the same category-tagged event shape (per `monitor-wall-display` D6), so
  the display renders them with no change to the server core, SSE, director, or client render

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

### Requirement: Hybrid control — autonomous worker with sparse context hints

The expensive graph modality SHALL be driven by an autonomous producer that watches the
transcript itself, keeping the main session OUT of the per-tick critical path. The main
session SHALL be able to supply sparse, cheap context hints (e.g. canonical component names
from the knowledge base) on topic change rather than per tick, to ground the output without
serializing the hot path.

#### Scenario: Graph updates without the main session in the loop

- **WHEN** the transcript advances with architecture-relevant content and no new context hint
  has been issued
- **THEN** the graph producer emits a delta on its own, without a round-trip through the main
  session

#### Scenario: Context hint grounds naming without per-tick cost

- **WHEN** the main session detects a topic change and issues a context hint naming the
  canonical entities
- **THEN** subsequent graph deltas use those names, and the hint is consumed once (not
  re-issued per transcript line)

### Requirement: Latency budget

The feed SHALL meet a per-modality latency budget: the text path SHALL add only the render
hop (single/double-digit milliseconds locally) over in-session output; the graph path SHALL
land within the small-delta live budget (approximately 1–4 seconds per delta, per the
research), and SHALL be faster than having the main model render the visual directly.

#### Scenario: Graph delta beats main-model rendering

- **WHEN** a diagram update is needed
- **THEN** the small-model delta path is used (≈1–4 s) rather than the main model generating
  the full visual (10+ s), and the graph path runs in parallel with text so it never delays
  text output

### Requirement: Speaker and zone primitives preserved

Producers SHALL consume the existing `speaker` (`mic` | `system`) and `zone`
(`private` | `public` | `both`) primitives rather than inventing a new capture or routing
path. Voice command scoping SHALL remain restricted to `mic`.

#### Scenario: A producer preserves speaker attribution

- **WHEN** a text producer emits a `transzkript` event derived from a `system`-tagged
  transcript line
- **THEN** the emitted event carries `speaker: "system"` so the display keeps the én/mindenki
  más distinction

