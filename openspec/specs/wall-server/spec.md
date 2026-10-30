# wall-server Specification

## Purpose
Serve the monitor wall locally: a `set-copilot wall` HTTP server whose config-declared windows
receive category-tagged display events over a resumable SSE stream, fed from any number of producers
through the canonical `wall-events.jsonl` log, with server-side playout and state replay so every
window — late-joining or reconnecting — shows the same, current state without a manual reload.

## Requirements

### Requirement: Wall command serves a local display

The system SHALL provide a `set-copilot wall` command that starts a local HTTP server
serving the static display assets (HTML/CSS/JS) and an SSE event stream. The command
SHALL print its base URL and, for every declared window, the window's name, URL, resolved
audience, zones and layout, and SHALL NOT require any cloud account. The server SHALL bind
the loopback interface (`127.0.0.1`) unless a host is explicitly configured: the loopback
bind is the whole access control of the wall's media and input endpoints, so exposing it
on another interface SHALL be a deliberate configuration, never a default.

#### Scenario: Start the wall

- **WHEN** the user runs `set-copilot wall`
- **THEN** a local HTTP server starts, serves the display assets, and prints its base URL
  and one line per declared window (name, URL, audience, zones, layout) to the console

#### Scenario: The wall is not reachable from the network by default

- **WHEN** the wall starts with no host configured
- **THEN** it SHALL listen on `127.0.0.1` only

### Requirement: Config-driven windows

The set of windows SHALL be defined entirely in config — no window is hardcoded. Each
window entry declares its `name`, its `route` (URL path), its `zones` filter
(`private` | `public` | `both`), its `audience`, and its display: a `layout` id with the
`boxes` placed in it, or the legacy `slots` list (which resolves onto the stacked layout).
The server SHALL serve exactly the windows declared in config; the shipped default is a
single public window at `/wall`, and no route is fixed.

A client SHALL receive a display event only when the event's `zone` matches the window's
zones **and** at least one box in the window subscribes to the event's category. A
public-audience window SHALL receive the redacted variant of the event, or nothing when
redaction withholds it.

#### Scenario: Windows come from config

- **WHEN** the config declares windows `[{name:"én", route:"/", zones:["private","both"], audience:"operator", layout:..., boxes:{...}}, {name:"fal", route:"/wall", zones:["public","both"], audience:"public", layout:..., boxes:{...}}]`
- **THEN** the server serves those two windows at those routes with those names and
  layouts, and serving a third window requires only adding a config entry (no code change)

#### Scenario: Private window hides public-only events

- **WHEN** an event with `zone: "private"` is broadcast and a client is on the public
  window (`zones: ["public","both"]`)
- **THEN** the public window SHALL NOT render that event, while a private window
  (`zones: ["private","both"]`) with a box subscribing to its category SHALL render it

#### Scenario: Both-zone event appears everywhere

- **WHEN** an event with `zone: "both"` is broadcast
- **THEN** every window with a box subscribing to its category receives it — a
  public-audience window its redacted variant

#### Scenario: An unsubscribed category is not sent

- **WHEN** an event's zone matches a window but no box in that window subscribes to its
  category
- **THEN** that window's clients SHALL NOT receive it

### Requirement: SSE broadcast transport

The server SHALL expose a single Server-Sent Events endpoint (`/events`) that broadcasts
display events to all connected clients. The transport SHALL be SSE (not WebSocket) and
SHALL support the browser's native auto-reconnect.

Delivery SHALL be resumable: every broadcast message SHALL carry a monotonically increasing
identifier, scoped to the current server run, and a reconnecting client SHALL be able to
present the last identifier it received (as `Last-Event-ID` or a query parameter) so the
server can deliver what it missed from a bounded tail of recent broadcasts. Where the server
cannot satisfy a resume request — the requested position is no longer retained, it belongs to
an earlier server run, or no identifier is presented — it SHALL fall back to a full state
replay rather than silently delivering a gap, and SHALL announce that fallback to the client
before the replay, so the client rebuilds its display from the replay instead of appending
to what it is showing.

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

#### Scenario: A cursor from an earlier server run is not honoured

- **WHEN** the server restarts and a client reconnects presenting an identifier from the
  previous run
- **THEN** the server SHALL announce a full replay and send the full state, and the client
  SHALL clear its boxes and rebuild them from that replay

### Requirement: State replay on connect

When a new client connects, the server SHALL replay the current display state so a window
opened mid-session reflects the present state rather than starting blank: the accumulated
visuals of every paced category that has a shown visual (the other accumulated visuals of
that category first, the shown one last), the pinned latest item of each subscribed
non-scrolling category, and the scroll history rings — always through the same zone and
redaction gates as live delivery.

Replay SHALL be idempotent from the client's perspective. On a resumed stream the client
SHALL end in the same displayed state as one that never disconnected. On a full-replay
fallback the client SHALL rebuild its display from the replayed state rather than append to
it, so no item is shown twice; a scrolling lane then holds what its replay ring retained.

#### Scenario: Late-joining wall gets current state

- **WHEN** a graph has grown to several nodes and a new public window connects afterward
- **THEN** the new client receives the accumulated graph state on connect and renders the
  current graph, not an empty canvas

#### Scenario: A reconnect does not duplicate the log

- **WHEN** a client showing a scrolled log of events reconnects and the server replays
  state
- **THEN** the log SHALL NOT contain any line twice — on a resumed stream the reconnected
  client's display SHALL match that of a client whose stream never dropped, and on a full
  replay it SHALL be rebuilt from the replayed rings

### Requirement: Server-side playout director

Swaps between graph visuals in a paced box SHALL be scheduled by the server, so that multiple
walls show the same graph at the same time: a new visual (a graph `reset`) is offered to the
director, and the swap command originates server-side and propagates to all walls. Pacing
(dwell/freshness) SHALL apply ONLY to paced canvas swaps; events that do not target a paced
box SHALL broadcast immediately. An ingested event carrying `priority: "immediate"` SHALL be
broadcast at once, bypassing any pacing — the director never holds it.

A change of render type inside a paced box (for example a chart arriving while a graph is
shown) is not a director swap: each client SHALL defer it until that box's minimum dwell,
measured from that client's own last swap, has elapsed — unless it is `immediate`.

#### Scenario: Two walls stay in sync

- **WHEN** two public walls are connected and a paced canvas swaps to a new graph visual
- **THEN** both walls swap to the same visual at the same time, driven by the single
  server-side director

#### Scenario: Immediate-priority event bypasses pacing

- **WHEN** an ingested event carries `priority: "immediate"` (a producer's urgent visual or
  scroll-log line)
- **THEN** the server broadcasts it to matching windows at once, without applying any
  dwell/freshness delay; only paced canvas swaps are subject to the director's pacing

#### Scenario: A render-type change waits out the dwell on the client

- **WHEN** a paced box is showing a graph and a chart for the same box arrives before the
  box's minimum dwell has elapsed, without `immediate`
- **THEN** the client SHALL keep the graph until the dwell has elapsed, then show the chart

### Requirement: Producer-agnostic event source

The server SHALL accept its events from an event-source abstraction rather than a single
hardcoded producer. Any number of concurrent producers SHALL be able to emit
category-tagged events into the same broadcast stream; the server merges them and
broadcasts by category/zone without knowing or caring which producer emitted which event.
The scripted fake-feed is one such source; the JSONL log tailer is another, fed by forks, the
main session and the mirror follower alike.

#### Scenario: Multiple concurrent producers feed one stream

- **WHEN** two independent producers emit events concurrently — one emitting `narráció`
  text events, another emitting `architektúra` graph events
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
mode SHALL exercise text, graph and chart payloads, a pending marker, and paced swaps. Its
events SHALL be `zone:"both"` (the shipped default has no private view, so a private beat
would render nowhere), SHALL be ingested in-process, and SHALL NOT be written to the
canonical event log. The fake-feed SHALL be on unless `set-copilot wall` is started with
`--no-fake-feed`, and the startup output SHALL say when it is on.

#### Scenario: Run the display from a script

- **WHEN** the wall is started in fake-feed mode with a scripted timeline
- **THEN** the server emits the scripted events over SSE on their timeline, driving the
  windows' boxes (scroll, latest, paced canvas) with no microphone or model involved

#### Scenario: Real producers only

- **WHEN** the wall is started with `--no-fake-feed`
- **THEN** no scripted event is emitted, and only producer events from the canonical log
  reach the windows

#### Scenario: Scripted events never enter the canonical log

- **WHEN** the fake-feed runs
- **THEN** `wall-events.jsonl` receives none of its events, so a later rebuild from the log
  reproduces only real producer output

### Requirement: The root path reaches the wall

When no declared window claims the server root path (`/`), a request for it SHALL redirect
to a declared window's route rather than serve a page that cannot resolve a window: the
client derives its route from the location pathname, so a page served at `/` with no window
there would bootstrap-fail. When a project declares a window at `/`, that window SHALL be
served directly and no redirect SHALL occur.

#### Scenario: Root redirects to the single declared window

- **WHEN** the shipped default serves one window on `/wall` and a browser requests `/`
- **THEN** the server responds with a redirect to `/wall`, and the page there bootstraps
  normally

#### Scenario: A window declared at the root is served, not redirected

- **WHEN** a project config declares a window with route `/` and a browser requests `/`
- **THEN** the server serves that window's page directly

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
