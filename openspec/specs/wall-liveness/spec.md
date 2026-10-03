# wall-liveness

## Purpose

Make the wall show, at all times, whether audio capture is alive and how long ago speech was last
heard — derived by the server from the runtime directory, never from the copilot — so a silent, slow,
or dead copilot can never make the wall appear dead while capture is in fact still running.

## Requirements

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

The heartbeat SHALL additionally carry activity **per speaker channel**, so the mic and the system channel
are separately observable. Per-channel activity SHALL be derived server-side from the runtime directory, by
the same means as `lastHeardMsAgo` — never from anything the copilot emits, preserving this capability's
invariant that the party whose aliveness is in question cannot be the source of the signal.

Where a channel is not in use for a session (for example a dictation capture with no system channel), the
heartbeat SHALL represent that channel as absent rather than as silent, so "not captured" and "captured but
quiet" are distinguishable.

#### Scenario: Heartbeat continues during silence

- **WHEN** no new transcript line and no wall event has occurred for several seconds
- **THEN** the client still receives heartbeats and updates the displayed "last heard" age accordingly

#### Scenario: Injected heartbeat is rejected

- **WHEN** an event source appends a `heartbeat` message to the canonical events log
- **THEN** the server drops it with a warning and does not broadcast it

#### Scenario: One channel active, the other quiet

- **WHEN** speech is arriving on the mic channel while the system channel has been silent
- **THEN** the heartbeat SHALL report recent activity for the mic channel and its own, older age for the
  system channel

#### Scenario: An unused channel is absent, not silent

- **WHEN** a capture is running with only one channel
- **THEN** the heartbeat SHALL mark the other channel absent, so the display does not present it as a
  captured channel that happens to be quiet

### Requirement: The status is always visible regardless of layout

The client SHALL render the liveness status in a persistent strip that is present in every window/layout,
so that swapping box positions or layouts never hides it. The strip SHALL distinguish at least three
states: listening (capture alive, recent audio), quiet (capture alive, no audio for a threshold), and
capture-stopped (PID gone).

The strip SHALL show the mic and system channels as separate indications, and SHALL convey activity
visually rather than only as a sentence, so it is readable at wall distance. Its footprint SHALL remain
small enough not to compete with the content it sits above.

#### Scenario: Status survives a layout with no free box

- **WHEN** a window's layout fills every position with content boxes
- **THEN** the liveness strip is still shown, not omitted for lack of a box

#### Scenario: Channels are separately visible

- **WHEN** the mic channel is active and the system channel is quiet
- **THEN** the strip SHALL show that difference at a glance, without the viewer reading a sentence

#### Scenario: The strip stays readable at distance

- **WHEN** the wall is displayed on a 1920×1080 screen
- **THEN** the strip's state SHALL be distinguishable from across a room, and SHALL NOT occupy space that
  would otherwise be needed by the content boxes

### Requirement: The client judges transport liveness from the absence of the signal

The client SHALL treat the *absence* of heartbeats as evidence about its own connection,
and SHALL display a disconnected state distinct from listening, quiet, and capture-stopped.

This extends the capability's load-bearing invariant one layer outward. The heartbeat
establishes that capture is alive, but it travels over the connection whose health is in
question — so a dead stream leaves the last received heartbeat frozen on screen, and a
stale wall becomes indistinguishable from a quiet one. The party whose aliveness is in
question therefore cannot be the source of *that* signal either: only the client can
observe that nothing is arriving.

A wall that is not receiving SHALL NOT be able to present as a wall with nothing to say.

#### Scenario: A dead stream is shown as disconnected, not quiet

- **WHEN** the event stream drops while capture is still running, and no heartbeat arrives
  for longer than the expected interval allows
- **THEN** the status SHALL show a disconnected state, distinct from the quiet state, so
  the operator can tell "not receiving" from "nothing happening"

#### Scenario: Recovery is shown

- **WHEN** the stream re-establishes and heartbeats resume
- **THEN** the status SHALL return to the state the heartbeat describes, without a manual
  reload

#### Scenario: Capture-stopped is not masked by a healthy connection

- **WHEN** heartbeats are arriving normally and they report that capture has stopped
- **THEN** the status SHALL show capture-stopped — the connection being healthy SHALL NOT
  suppress it

### Requirement: A terminal message SHALL NOT wedge a lane

A message that reads as final SHALL NOT prevent a box from rendering subsequent events. No
content of an event SHALL be able to place a box into a state from which it stops
accepting updates.

Where a box stops updating for any reason, that condition SHALL be observable rather than
presenting as an absence of events.

#### Scenario: Rendering continues after a terminal-sounding line

- **WHEN** a box renders a message that reads as a completion or sign-off, and further
  events for that box arrive afterwards
- **THEN** the box SHALL render them

#### Scenario: A stalled box is distinguishable from an idle one

- **WHEN** a box is not updating
- **THEN** it SHALL be possible to determine whether events are arriving and not being
  rendered, or no events are arriving at all
