## ADDED Requirements

### Requirement: Wall command serves a local display

The system SHALL provide a `set-copilot wall` command that starts a local HTTP server
serving the static display assets (HTML/CSS/JS) and an SSE event stream. The command
SHALL print the URLs of its windows on startup and SHALL NOT require any cloud account.

#### Scenario: Start the wall

- **WHEN** the user runs `set-copilot wall`
- **THEN** a local HTTP server starts, serves the display assets, and prints the private
  and public window URLs to the console

### Requirement: Config-driven windows

The set of windows SHALL be defined entirely in config — no window is hardcoded. Each
window entry declares its `name`, its `route` (URL path), its `zones` filter
(`private` | `public` | `both`), and its slot layout (which categories appear where).
The server SHALL serve exactly the windows declared in config; `/` (private) and `/wall`
(public) are defaults/examples, not fixed routes. A window SHALL only render events whose
`zone` matches its filter.

#### Scenario: Windows come from config

- **WHEN** the config declares windows `[{name:"én", route:"/", zones:["private","both"], slots:[...]}, {name:"fal", route:"/wall", zones:["public","both"], slots:[...]}]`
- **THEN** the server serves those two windows at those routes with those names and
  layouts, and serving a third window requires only adding a config entry (no code change)

#### Scenario: Private window hides public-only events

- **WHEN** an event with `zone: "private"` is broadcast and a client is on the public
  window (`zones: ["public","both"]`)
- **THEN** the public window SHALL NOT render that event, while the private window
  (`zones: ["private","both"]`) SHALL render it

#### Scenario: Both-zone event appears everywhere

- **WHEN** an event with `zone: "both"` is broadcast
- **THEN** every window renders it regardless of its zone filter

### Requirement: SSE broadcast transport

The server SHALL expose a single Server-Sent Events endpoint (`/events`) that broadcasts
display events to all connected clients. The transport SHALL be SSE (not WebSocket) and
SHALL support the browser's native auto-reconnect.

#### Scenario: Broadcast reaches all clients

- **WHEN** two windows are open and the server emits an event
- **THEN** both connected clients receive the event over their `/events` stream

### Requirement: State replay on connect

When a new client connects, the server SHALL replay the current display state (at least
the accumulated graph state and pinned latest items) so a window opened mid-session
reflects the present state rather than starting blank.

#### Scenario: Late-joining wall gets current state

- **WHEN** a graph has grown to several nodes and a new public window connects afterward
- **THEN** the new client receives the accumulated graph state on connect and renders the
  current graph, not an empty canvas

### Requirement: Server-side playout director

The playout scheduling for paced slots SHALL be authoritative on the server, so that
multiple walls show the same item at the same time. Direct swap commands SHALL originate
server-side and propagate to all walls. Pacing (dwell/freshness) SHALL apply ONLY to paced
canvas swaps; events that do not target a paced slot SHALL broadcast immediately. An
ingested event carrying `priority: "immediate"` (e.g. an alert or scroll-log line from a
producer) SHALL be broadcast at once, bypassing any pacing — the director never holds it.

#### Scenario: Two walls stay in sync

- **WHEN** two public walls are connected and a paced canvas swaps to a new item
- **THEN** both walls swap to the same item at the same time, driven by the single
  server-side director

#### Scenario: Immediate-priority event bypasses pacing

- **WHEN** an ingested event carries `priority: "immediate"` (a producer's alert or
  scroll-log line)
- **THEN** the server broadcasts it to matching windows at once, without applying any
  dwell/freshness delay; only paced canvas swaps are subject to the director's pacing

### Requirement: Producer-agnostic event source

The server SHALL accept its events from an event-source abstraction rather than a single
hardcoded producer. Any number of concurrent producers SHALL be able to emit
category-tagged events into the same broadcast stream; the server merges them and
broadcasts by category/zone without knowing or caring which producer emitted which event.
The scripted fake-feed is one such source. This keeps the ingest side open for a future
change where each category/group is fed in parallel by a separate subagent producer.

#### Scenario: Multiple concurrent producers feed one stream

- **WHEN** two independent producers emit events concurrently — one emitting `transzkript`
  events, another emitting `architektúra` graph events
- **THEN** the server merges both into the single `/events` broadcast, and each window
  renders each event by its category/zone regardless of which producer emitted it

### Requirement: JSONL append-and-tail ingest transport

Out-of-process producers SHALL deliver events by appending category-tagged JSON lines to a
newline-delimited events file in the runtime dir, which the server tails — mirroring the
existing `capture` → `transcript.jsonl` → `poll` cross-process pattern. The events file is
the canonical event log: the server broadcasts each appended line over SSE and accumulates
it for state-replay, so a producer's in-memory state (e.g. a graph worker's accumulated
graph) is never the sole source of truth and does not need reconciling with the server on a
late client connect. The scripted fake-feed MAY emit in-process, but the file transport is
the seam a separate producer process uses.

#### Scenario: Producer appends, server tails and broadcasts

- **WHEN** a separate producer process appends a category-tagged JSON line to the runtime
  events file
- **THEN** the server tails the file, broadcasts the new line over SSE to matching windows,
  and includes it in the accumulated state replayed to future late-joining clients

#### Scenario: Events file is canonical on restart

- **WHEN** the server or a producer restarts mid-session
- **THEN** the accumulated state can be rebuilt by reading the events file, so no in-memory
  producer state is required to reconstruct what has been shown

### Requirement: Scripted fake-feed mode

For validating the display without audio or an LLM, the server SHALL support a scripted
fake-feed that emits a predefined sequence of category-tagged events on a timeline. This
mode SHALL exercise text and graph categories, zones, and paced swaps.

#### Scenario: Run the display from a script

- **WHEN** the wall is started in fake-feed mode with a scripted timeline
- **THEN** the server emits the scripted events over SSE on their timeline, driving the
  windows' slots (scroll, latest, paced canvas) with no microphone or model involved
