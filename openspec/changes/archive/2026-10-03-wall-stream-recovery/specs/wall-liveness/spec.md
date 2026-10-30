## ADDED Requirements

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
