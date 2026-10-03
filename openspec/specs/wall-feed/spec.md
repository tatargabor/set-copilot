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

The feed SHALL be composed of independent producers, each running concurrently and each emitting
its category-tagged events to the wall's producer-agnostic event source (the `wall-emit` append to
`<runtimeDir>/wall-events.jsonl`, tailed by the server's ingest funnel). A slow producer SHALL NOT
block a fast one (no head-of-line blocking): each producer emits when its own data is ready.
Producers SHALL NOT write directly to the SSE broadcast; they SHALL go through the event-source
ingest so the server-side director and the public-zone redaction stay authoritative.

Producers are partitioned by what they must do to produce their output:

- **Visual producers** (graph, chart, image) that must compose their content SHALL be forks of the
  main session, one category mandate each (see `fork-producer`). Concurrency is therefore per-fork
  concurrency, not a fleet of independently-running worker processes.
- **Text lanes** SHALL be emitted without a fork: narration and pinned updates by the main session
  itself through `wall-emit`, and the chat mirror by the `mirror-follow` process.
- **Mechanical producers** (for example a wall screenshot command) MAY emit from the CLI directly,
  through the same append path.

#### Scenario: A slow graph update does not delay an alert

- **WHEN** a graph producer fork is mid-computation on an expensive delta and the main session has
  a text update (a narration or pinned line) ready
- **THEN** the text update is ingested and broadcast without waiting for the graph delta to finish

#### Scenario: Producer output is byte-compatible with the fake-feed

- **WHEN** the real producers replace the scripted fake-feed
- **THEN** they emit the same category-tagged event shape, so the display renders them with no
  change to the server core, SSE, director, or client render

#### Scenario: Concurrent slot forks do not block each other

- **WHEN** two category mandates warrant an update at the same time
- **THEN** two forks run concurrently and each emits independently as soon as its own output
  is ready

#### Scenario: Text reaches the wall within the render-hop budget

- **WHEN** the main session has a narration or pinned line ready, or the mirror follower has a
  chat message to deliver
- **THEN** it is emitted directly to the event source with no intermediate LLM call, and the
  added latency over in-session output is the ingest hop only — the `wall-emit` append, the
  JSONL tail-poll (bounded by its poll interval), and the SSE + render hop — with no model
  round-trip on the path

#### Scenario: Alert bypasses the director's pacing

- **WHEN** an event is emitted with `priority: "immediate"`
- **THEN** it is shown at once without applying dwell/freshness pacing — the server-side director
  swaps an immediate graph visual in, and a paced box does not defer an immediate render-type
  change; without `immediate`, a render-type change arriving in a paced box mid-dwell is deferred
  by the client until that box's dwell has elapsed

### Requirement: Text path carries no model hop

The wall's text lanes — narration (`narráció`), pinned updates (`kitűzött`) and the chat mirror
(`tükör`) — SHALL reach the wall with no model call beyond the main session's own turn. Narration
and pinned updates are written by the main session as part of its turn and emitted directly; the
mirror is delivered by a mechanical follower of the session transcript. A model SHALL NOT be
inserted into the text path. Alert categories are a **chat** channel: the copilot's alerts SHALL
NOT be emitted to the wall.

There is deliberately no raw `transcript` text category: the wall's event stream carries only
processed copilot output, not a transcript mirror. A producer therefore never emits a
`transcript`/`transzkript` category — the registry has none, so the ingest funnel drops such an
event with a warning before it accumulates or reaches any client. (A transcript page, where a
project configures one, is a separate route outside the event stream.)

#### Scenario: Text reaches the wall within the render-hop budget

- **WHEN** the main session has a narration or pinned line ready
- **THEN** it is emitted directly to the event source with no intermediate LLM call, and the
  added latency over in-session output is the ingest hop only — the `wall-emit` append, the
  JSONL tail-poll, and the SSE + render hop. (An in-process source such as the fake-feed, which
  calls the ingest callback directly, avoids the tail-poll and the process spawn.)

#### Scenario: Alert bypasses the director's pacing

- **WHEN** an alert category fires
- **THEN** the alert is delivered in chat, never as a wall event, so no wall pacing can delay it;
  on the wall, only an event marked `priority: "immediate"` bypasses dwell/freshness pacing

#### Scenario: A transcript category is dropped at ingest

- **WHEN** a producer emits an event in a `transcript` category
- **THEN** the server drops it with a warning, and no client receives it

### Requirement: Latency budget

The feed SHALL meet a per-modality latency budget. The text path SHALL add only the ingest hop
over in-session output: the `wall-emit` append and process spawn, the JSONL tail-poll (bounded
by its poll interval), and the SSE + render hop — with no model round-trip. The sub-millisecond
figure applies only to an in-process source (the fake-feed) that calls the ingest callback
directly; a real out-of-process text producer additionally pays the tail-poll interval and the
`wall-emit` spawn.

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
path. Addressing the copilot **by name** (the `detect.command` flag on a transcript line) SHALL
remain restricted to `mic`. A bracketed fast-lane command, by contrast, SHALL be recognised on
either channel. A display event MAY carry `speaker`; when it does, the text renderer SHALL style
`mic` and `system` lines distinguishably.

#### Scenario: A producer preserves speaker attribution

- **WHEN** a producer emits a text event derived from a `system`-tagged transcript line (something
  the remote/system speaker said) and sets `speaker: "system"`
- **THEN** the event keeps that attribution through ingest and the display renders it distinctly
  from a `mic` line, keeping the én/mindenki más distinction

#### Scenario: Name-addressing is mic-only

- **WHEN** the copilot's name is heard on the `system` channel
- **THEN** the transcript line SHALL NOT be flagged as addressing the copilot

### Requirement: Every appended event records when it was emitted

A **display event** appended to the canonical wall event log SHALL carry `emittedAt`, the
wall-clock time in milliseconds at which it entered the log. The value SHALL be written by the
append path itself, after the event is normalized, so that it is uniform across producers and
cannot be supplied or suppressed by one. Control lines appended to the same log — `pending`,
`promote` and `layout` — are not display events and carry no `emittedAt`.

`emittedAt` is the time the event reached the wall — never the time anything was said. The
transcript's own timestamps mean speech time, and a consumer that treated the two as the
same unit would compute a number that looks like a latency and is not one.

#### Scenario: An emitted event carries its emission time

- **WHEN** a producer emits a valid display event
- **THEN** the line appended to the log carries an `emittedAt` millisecond timestamp

#### Scenario: A producer cannot set its own emission time

- **WHEN** a producer supplies an `emittedAt` of its own
- **THEN** the appended event carries the time the append path observed, not the supplied one

#### Scenario: Every event of one batch is stamped

- **WHEN** several display events are emitted in a single call
- **THEN** each appended line carries an `emittedAt`, in non-decreasing order

#### Scenario: A rejected event is not stamped into the log

- **WHEN** an event fails normalization
- **THEN** it is dropped as before, and nothing is appended for it

#### Scenario: A control line is not stamped

- **WHEN** a `pending`, `promote` or `layout` command is appended to the log
- **THEN** its line carries no `emittedAt`

### Requirement: An event with no emission time is read as unknown

A consumer of the event log SHALL treat a missing `emittedAt` as unknown time, and SHALL
NOT substitute zero, the current time, or a neighbouring event's time.

Logs written before this field existed remain valid and are never backfilled: a stamp
invented after the fact would be indistinguishable from a real one and would corrupt
exactly the measurements the field exists to enable.

#### Scenario: An older log still replays

- **WHEN** a log whose events carry no `emittedAt` is replayed to rebuild state
- **THEN** the state is reconstructed exactly as before, with the times reported as unknown

#### Scenario: A timing measurement over an unstamped event is refused, not guessed

- **WHEN** a consumer computes a timing figure over an event with no `emittedAt`
- **THEN** the figure is reported as unmeasurable rather than derived from a substituted value
