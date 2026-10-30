## MODIFIED Requirements

### Requirement: SSE broadcast transport

The server SHALL expose a single Server-Sent Events endpoint (`/events`) that broadcasts
display events to all connected clients. The transport SHALL be SSE (not WebSocket) and
SHALL support the browser's native auto-reconnect.

Delivery SHALL be resumable: every broadcast message SHALL carry a monotonically increasing
identifier, and a reconnecting client SHALL be able to present the last identifier it
received so the server can deliver what it missed. Where the server cannot satisfy a resume
request — the requested position is no longer retained, or no identifier is presented — it
SHALL fall back to a full state replay rather than silently delivering a gap.

#### Scenario: Broadcast reaches all clients

- **WHEN** two windows are open and the server emits an event
- **THEN** both connected clients receive the event over their `/events` stream

#### Scenario: A reconnecting client resumes from where it stopped

- **WHEN** a client's stream drops, events are broadcast while it is disconnected, and it
  reconnects presenting the last identifier it received
- **THEN** the server SHALL deliver the events it missed, and SHALL NOT re-deliver events
  it had already received

#### Scenario: An unsatisfiable resume falls back to full state

- **WHEN** a client reconnects presenting an identifier the server no longer retains, or
  presents none at all
- **THEN** the server SHALL perform a full state replay, so the client is correct rather
  than missing an unknown amount of history

### Requirement: State replay on connect

When a new client connects, the server SHALL replay the current display state (at least
the accumulated graph state and pinned latest items) so a window opened mid-session
reflects the present state rather than starting blank.

Replay SHALL be idempotent from the client's perspective: a client that reconnects SHALL
end in the same displayed state as one that never disconnected. Replayed content SHALL NOT
duplicate content the client is already showing.

#### Scenario: Late-joining wall gets current state

- **WHEN** a graph has grown to several nodes and a new public window connects afterward
- **THEN** the new client receives the accumulated graph state on connect and renders the
  current graph, not an empty canvas

#### Scenario: A reconnect does not duplicate the log

- **WHEN** a client showing a scrolled log of events reconnects and the server replays
  state
- **THEN** the log SHALL NOT contain any line twice — the reconnected client's display
  SHALL match that of a client whose stream never dropped

## ADDED Requirements

### Requirement: A client re-reads its window definition on reconnect

On re-establishing its event stream, a client SHALL re-fetch its window definition and
category registry before resuming rendering, so that changes to a window's boxes,
categories, or layout take effect without a manual page reload.

Where the re-fetched definition differs from the one currently mounted, the client SHALL
re-derive its display from the new definition.

#### Scenario: A box change lands without a reload

- **WHEN** a window's box subscriptions are changed while a wall is open, and the wall's
  stream reconnects
- **THEN** the client SHALL adopt the new subscriptions without the operator reloading the
  page

#### Scenario: An unchanged definition does not disturb the display

- **WHEN** a client reconnects and its window definition is unchanged
- **THEN** the display SHALL continue without being torn down and rebuilt
