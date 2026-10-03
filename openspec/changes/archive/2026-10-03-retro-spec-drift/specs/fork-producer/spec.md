## MODIFIED Requirements

### Requirement: The producer is a fork of the main session

A wall producer that has to **compose** a visual — read sources, work something out, or build a
graph or chart from the discussion — SHALL be a fork of the main Claude Code session
(`subagent_type: "fork"`), inheriting the parent's full conversation context. A producer SHALL NOT
be a separate model client with its own independently-assembled context.

The inherited context IS the grounding: the fork carries the same understanding the chat has,
so it does not have to infer from the transcript alone what matters.

Content that is already settled in the conversation SHALL NOT pay a fork's cost (measured at
16–62 s and tens of thousands of tokens per drawing, against about a second for a direct emit):
a one-line note, a narration line, a pinned update, a pending marker, a promotion, or a visual
whose full content is already stated in the chat SHALL be emitted by the main session directly
through `wall-emit`. The chat mirror is not a model producer at all: it is emitted by the
`mirror-follow` process.

#### Scenario: Fork inherits the chat's understanding

- **WHEN** the main session and the user have established that the topic is the wall producer
  architecture, and a graph is to be drawn
- **THEN** the fork is spawned with the conversation context already inherited, and draws the
  architecture as understood in the chat — it does not re-derive the topic from the raw
  transcript

#### Scenario: No separate model client

- **WHEN** a producer needs to emit a visual
- **THEN** it does so as a fork (or, for settled content, as the main session) invoking
  `set-copilot wall-emit`, with no model SDK, no API key handling, and no transcript sent to a
  separate model

#### Scenario: Settled content is emitted without a fork

- **WHEN** the content to show is already fully stated in the conversation (a one-line note, a
  narration line, a pinned update, a promotion)
- **THEN** the main session emits it directly with `wall-emit` and spawns no fork

### Requirement: One fork per slot mandate, parallelizable

Each producer fork SHALL receive a narrow mandate naming exactly one **category** (the unit a box
subscribes to; "slot" is the legacy name), and SHALL emit only into that category. Multiple forks
MAY be spawned concurrently, one per category. The narrow scope is itself grounding: the fork is
told which category it serves, rather than deciding for itself what to capture.

#### Scenario: Concurrent slot forks

- **WHEN** both the architecture canvas and the metrics chart warrant an update
- **THEN** two forks are spawned concurrently, each with a mandate naming its own category, and
  each emits only its own category

#### Scenario: A fork stays within its mandate

- **WHEN** a fork mandated to draw the metrics chart notices architecture-relevant content
- **THEN** it emits only its own category; it does not emit into another category

### Requirement: The emission seam is unchanged

A producer fork SHALL emit only through the `set-copilot wall-emit` seam into
`<runtimeDir>/wall-events.jsonl`. There SHALL be no fork-specific wire shape: a fork's line is the
same category-tagged event any other producer appends, carries the same zone routing, and is
handled by the same server-side ingest and director. The emission timestamp (`emittedAt`) SHALL be
stamped by the append path at the moment of appending, never supplied by the producer.

#### Scenario: Wire format is identical to the previous producer

- **WHEN** a fork emits a graph delta
- **THEN** the emitted line is the same category-tagged shape the fake-feed and every other
  producer emit, and the server core, SSE, director, and client renderer treat it no differently

#### Scenario: The producer does not stamp its own emission time

- **WHEN** a fork's event carries its own `emittedAt`
- **THEN** the append path SHALL replace it with the time of the append
