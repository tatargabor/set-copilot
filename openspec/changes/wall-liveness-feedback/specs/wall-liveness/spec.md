## ADDED Requirements

### Requirement: The wall shows a persistent liveness signal derived independently of the copilot

The wall SHALL display, at all times, whether audio capture is alive and how long ago the last speech
was heard. This signal SHALL be derived by the wall server from the runtime directory it serves — the
capture PID file and the freshness of the transcript — and SHALL NOT depend on the copilot emitting
anything. A copilot that has gone silent, slow, or dead MUST NOT be able to make the wall appear dead
when capture is in fact still running.

This is the load-bearing invariant: the thing whose aliveness is in question (the copilot) cannot be the
source of the aliveness signal.

#### Scenario: Capture alive, copilot silent

- **WHEN** audio capture is running and writing transcript lines, but the copilot has emitted nothing to
  the wall for a while
- **THEN** the wall's status still shows "listening" with a recent "last heard" age — not a dead or blank
  state

#### Scenario: Capture stopped

- **WHEN** the capture process for this runtime dir is no longer alive (its PID is gone)
- **THEN** the wall's status shows an explicit "capture stopped" state, distinct from "listening" and from
  "quiet"

### Requirement: The liveness signal is broadcast on a timer, not on transcript events

The wall server SHALL broadcast a `heartbeat` wire message to every connected client on a fixed interval,
carrying at least `captureAlive` (boolean) and `lastHeardMsAgo` (the age of the newest transcript line, or
null if none). The heartbeat SHALL be server-authoritative — a producer or external source that injects a
`heartbeat` SHALL be dropped, exactly as an injected `show` command is.

#### Scenario: Heartbeat continues during silence

- **WHEN** no new transcript line and no wall event has occurred for several seconds
- **THEN** the client still receives heartbeats and updates the displayed "last heard" age accordingly

#### Scenario: Injected heartbeat is rejected

- **WHEN** an event source appends a `heartbeat` message to the canonical events log
- **THEN** the server drops it with a warning and does not broadcast it

### Requirement: The status is always visible regardless of layout

The client SHALL render the liveness status in a persistent strip that is present in every window/layout,
so that swapping box positions or layouts never hides it. The strip SHALL distinguish at least three
states: listening (capture alive, recent audio), quiet (capture alive, no audio for a threshold), and
capture-stopped (PID gone).

#### Scenario: Status survives a layout with no free box

- **WHEN** a window's layout fills every position with content boxes
- **THEN** the liveness strip is still shown, not omitted for lack of a box
