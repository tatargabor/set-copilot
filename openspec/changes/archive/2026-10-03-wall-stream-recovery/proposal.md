## Why

The most-repeated field complaint about the wall is that it goes stale and only a hard
reload brings it back — three sessions now, most recently mid-meeting on 2026-07-28: *"meg
még mindig nem láttuk alul frissíteni, de lehet, hogy refreshelnem kell a szövegeset"*
(`docs/wall-field-backlog.md` §A3, P0 #1 and #2). Box and category changes likewise need a
reload to take effect.

Underneath it is a gap in the same invariant `wall-liveness` was built on. That spec is
explicit: *"the thing whose aliveness is in question cannot be the source of the aliveness
signal"* — which is why the heartbeat is derived by the server from the runtime dir rather
than emitted by the copilot. But the heartbeat travels over the very connection whose
health is in question. When the SSE stream dies, the client keeps displaying the last
heartbeat it received, and a **stale wall is pixel-identical to a quiet one**. There is no
`onerror` and no `onopen` handler in `connect()` (`src/wall/public/wall.js:65-77`) — the
client never learns the stream dropped, so it can neither say so nor act on it.

Reconnect itself is only half-wired: the server sends `retry: 2000` (`server.ts:801`) and
the browser's native EventSource does re-open, and `replay()` (`server.ts:707`) resends the
scroll rings, pinned latest, and accumulated graphs. But replay is not idempotent — the
client has no notion of which events it already has, so a reconnect re-appends history it
is already showing — and nothing re-fetches `/api/bootstrap`, so a window's layout, boxes,
and category registry stay whatever they were when the tab was opened.

Separately and still unexplained: the narration/text lane has been observed wedging on a
terminal line while graph and chart draws kept working (P0 #1). This change does not claim
a root cause for that; it builds the instrumentation that tells "wedged" apart from
"nothing to say", and carries the reproduction as work.

## What Changes

- **The client judges transport liveness itself**, from the *absence* of heartbeats plus
  the stream's own error/open events, and shows a disconnected state distinct from
  "listening", "quiet", and "capture stopped". A wall that is not receiving must say so.
- **Reconnect is resumable and idempotent.** Events carry an id; a reconnecting client
  presents the last id it saw and receives what it missed rather than a re-run of history
  it is already displaying.
- **Reconnect re-bootstraps.** On re-establishing the stream the client re-fetches its
  window definition and category registry, so box, category, and layout changes land
  without a hard reload.
- **A terminal message must not wedge a lane.** The narration/text path gets the
  requirement stated and the reproduction attempted with the new visibility.
- Non-goals: no transport change (SSE stays, WebSocket is not revisited), no change to
  zoning, redaction, the director, or the JSONL ingest path, and no change to what the
  heartbeat carries.

## Capabilities

### Modified Capabilities
- `wall-server`: the SSE transport gains resumable delivery (event ids honoured on
  reconnect), and state replay must be idempotent for a reconnecting client rather than
  duplicating what it already shows.
- `wall-liveness`: transport liveness is judged by the client from heartbeat absence, and a
  wall that is not receiving SHALL NOT be able to look like a wall with nothing to say.

## Impact

- `src/wall/server.ts` — per-event `id:` on the wire, `Last-Event-ID` honoured at
  `handleSse`, and `replay()` split into "resume from id" and "full state" paths.
- `src/wall/public/wall.js` — `onerror`/`onopen` handling in `connect()`, a heartbeat-gap
  watchdog, re-bootstrap on reconnect, and the new status state.
- `src/wall/public/wall-core.mjs` — the pure part of the liveness-state decision, so it is
  unit-testable (it already hosts the layout/dispatch pure logic).
- `src/wall/public/wall.css` — the disconnected state's styling in the status strip.
- Tests: the liveness-state decision and the resume-window computation are pure and
  unit-tested; the browser behavior is verified by running the wall and killing the server.
