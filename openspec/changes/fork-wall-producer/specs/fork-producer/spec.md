## ADDED Requirements

### Requirement: The producer is a fork of the main session

The wall producer SHALL be a fork of the main Claude Code session (`subagent_type: "fork"`),
inheriting the parent's full conversation context. A producer SHALL NOT be a separate model
client with its own independently-assembled context.

The inherited context IS the grounding: the fork carries the same understanding the chat has,
so it does not have to infer from the transcript alone what matters.

#### Scenario: Fork inherits the chat's understanding

- **WHEN** the main session and the user have established that the topic is the wall producer
  architecture, and a graph is to be drawn
- **THEN** the fork is spawned with the conversation context already inherited, and draws the
  architecture as understood in the chat — it does not re-derive the topic from the raw
  transcript

#### Scenario: No separate model client

- **WHEN** a producer needs to emit a visual
- **THEN** it does so as a fork invoking `set-copilot wall-emit`, with no model SDK, no API key
  handling, and no transcript sent to a separate model

### Requirement: The fork terminates after emitting

A producer fork SHALL complete its mandate, emit through the `wall-emit` seam, and terminate.
It SHALL NOT idle waiting for further work, and its tool output SHALL NOT be returned into the
parent session's context.

#### Scenario: Fork exits after drawing

- **WHEN** a fork has emitted its slot's events
- **THEN** it terminates; no process remains holding the inherited context alive

#### Scenario: Fork output does not pollute the parent

- **WHEN** a fork reads files or runs commands to build its visual
- **THEN** that tool output stays in the fork, and only the completion is surfaced to the
  parent

### Requirement: Emission is on demand, not polled

A producer fork SHALL be spawned when there is something to draw. The system SHALL NOT run
long-poll producer forks that wait for work, because a waiting fork holds the inherited
context alive while doing nothing.

#### Scenario: No tick-driven emission

- **WHEN** the transcript advances but nothing warrants a visual update
- **THEN** no fork is spawned

#### Scenario: Fork spawned at the moment of need

- **WHEN** the main session determines a slot's visual is now stale or newly warranted
- **THEN** a fork is spawned at that point, emits, and exits

### Requirement: One fork per slot mandate, parallelizable

Each producer fork SHALL receive a narrow mandate scoped to a single slot. Multiple forks MAY
be spawned concurrently, one per slot. The narrow scope is itself grounding: the fork is told
which slot it serves, rather than deciding for itself what to capture.

#### Scenario: Concurrent slot forks

- **WHEN** both the architecture canvas and the metrics chart warrant an update
- **THEN** two forks are spawned concurrently, each with a mandate naming its own slot, and
  each emits only its own category

#### Scenario: A fork stays within its mandate

- **WHEN** a fork mandated to draw the metrics chart notices architecture-relevant content
- **THEN** it emits only its own category; it does not emit into another slot

### Requirement: The drawing contract lives in the base context

Everything needed for every drawing — the category registry, the `wall-emit` payload shapes,
the render types, and the drawing conventions — SHALL be part of the policy rendered by
`set-copilot prompt` and loaded once at session start. A fork's own prompt SHALL carry only
its mandate.

This exists so the fork inherits the contract from an already-cached prefix rather than having
it re-supplied on every emission.

#### Scenario: Contract is inherited, not re-supplied

- **WHEN** a fork is spawned to draw a slot
- **THEN** its prompt contains the mandate only; the payload shapes and category registry come
  from the inherited base context

#### Scenario: Contract is configurable, not hardcoded in the skill

- **WHEN** a project renames its categories or changes its drawing conventions
- **THEN** the change is made in config and flows through `set-copilot prompt`, with no edit to
  any skill file and no change to `src/`

### Requirement: The fork runs on the parent's model tier

A producer fork SHALL run on the model of the session that spawned it. The system SHALL NOT
assume a cheaper tier is available for producers, and SHALL NOT specify a model override for a
producer fork, since the override is ignored.

#### Scenario: No model downgrade for producers

- **WHEN** a producer fork is spawned from an Opus session
- **THEN** it runs on Opus; any configured cheaper tier for producers has no effect

### Requirement: The emission seam is unchanged

A producer fork SHALL emit through the existing `set-copilot wall-emit` seam into
`<runtimeDir>/wall-events.jsonl`. The wire format, the category-tagged event shape, the zone
routing, and the server-side director SHALL be unaffected by this change of producer.

#### Scenario: Wire format is identical to the previous producer

- **WHEN** a fork emits a graph delta
- **THEN** the emitted line is the same category-tagged shape the fake-feed and the previous
  producers emitted, and the server core, SSE, director, and client renderer require no change
