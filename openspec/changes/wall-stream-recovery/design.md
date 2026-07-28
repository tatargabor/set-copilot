## Context

`connect()` (`src/wall/public/wall.js:65-77`) assigns exactly one handler — `es.onmessage`
— and nothing else. No `onerror`, no `onopen`, no watchdog. The browser's native
auto-reconnect does fire (the server writes `retry: 2000` at `server.ts:801`), and
`replay()` (`server.ts:707`) resends the zone-appropriate scroll rings, pinned latest, and
the accumulated graph slice per shown visual. So the machinery for "come back" exists; what
is missing is that the client never knows it left, never tells anyone, and comes back to a
re-run of history it is already displaying.

The bootstrap is fetched exactly once, in `boot()` (`wall.js:13-21`), so a window's boxes,
categories, and layout are frozen at page-open time — hence "box/category changes also need
a reload".

Two facts constrain the design. `wall-core.mjs` is deliberately DOM-free so it can be
imported by vitest — that is where any new decision logic belongs. And zoning is enforced
at broadcast and replay time (`isPublicClient`, the per-zone stores, the `visual`-id guard
at `server.ts:734-737`); a resume path is a *third* way for events to reach a client, so it
has to inherit those gates rather than reimplement them.

## Goals / Non-Goals

**Goals:**
- A wall that is not receiving says so — the operator stops having to guess whether the
  meeting is quiet or the wall is dead.
- A reconnect ends in the same displayed state as never having disconnected.
- Config/layout changes land on reconnect instead of requiring a reload.

**Non-Goals:**
- Not a transport change. SSE stays; WebSocket is not revisited.
- No change to zoning, redaction, the director, the heartbeat's contents, or JSONL ingest.
- Not a claimed fix for the narration wedge (P0 #1). This change makes it observable and
  carries the reproduction; if the reproduction lands a cause, the fix follows here, and if
  it does not, that is reported rather than papered over.
- No offline buffering in the client beyond what resume needs.

## Decisions

### D1 — Resume rides on the SSE `id:` field and `Last-Event-ID`, not a bespoke protocol

Every broadcast line gains an `id:` (a monotonic counter for this server run). The browser
stores it and re-presents it as the `Last-Event-ID` request header automatically — no
client code, no query parameter, no reconnect handshake. `handleSse` reads the header and,
when it can satisfy it, streams the missed tail instead of calling `replay()`.

Using the transport's own mechanism is what keeps this small: the alternative — a custom
`?since=` parameter — means the client has to track and persist the cursor itself, which is
the part the browser already does correctly, including across the native retry.

*Retention:* the tail buffer is bounded (the scroll rings are already bounded, and this
reuses that sizing discipline). Beyond it, resume is unsatisfiable — see D2.

### D2 — An unsatisfiable resume falls back to full replay, and that must stay explicit

If the presented id predates what is retained, or no id is presented, the server does a
full state replay. This is the honest failure: the client ends up correct, possibly having
re-received some state, rather than quietly missing an unknown span. The spec says so as a
scenario because it is the branch most likely to be optimized away later.

Server-run identity matters here: a restarted server's counter starts over, so ids carry
the run's identity and a mismatched run forces the fallback. Without that, a restart would
look like "you're already up to date" and leave the wall silently stale — the exact failure
class this change exists to remove.

### D3 — Idempotency is the server's job via resume, not the client's via dedup

The spec requires that a reconnected client's display match one that never dropped. Two
ways to get there: resume (send only what was missed) or client-side dedup (send
everything, drop what is already shown). Resume is chosen because dedup needs a stable
per-event identity in the *client's* rendered DOM, which the scroll lane does not have, and
because it also fixes the wasted bandwidth and the visible re-render.

The fallback path (D2) can still duplicate. That is accepted and bounded: it happens only
on a retention miss or a server restart, where a rebuilt display is the correct outcome
anyway — so the fallback SHOULD rebuild the affected lanes rather than append to them.

### D4 — Transport liveness is a client-side watchdog over heartbeat arrivals, not `onerror` alone

`onerror` fires for an outright failure, but the observed field symptom is a stream that
stops delivering while the object still looks open. So the primary signal is a **watchdog
on heartbeat arrival**: heartbeats come on a fixed 1000 ms interval (`server.ts:299`), so
their absence past a small multiple of that is positive evidence of a dead pipe, whatever
`readyState` claims. `onerror`/`onopen` refine the state; they do not define it.

The decision function (last-heartbeat age + readyState → status state) goes in
`wall-core.mjs` as a pure function and is unit-tested. The threshold is derived from the
heartbeat interval the server already advertises, not hardcoded a second time.

This is the same reasoning `wall-liveness` used one level down — the party whose aliveness
is in question cannot be the source of the signal — applied to the transport.

### D5 — Re-bootstrap on every `onopen`, and diff before remounting

On stream open (including the first), fetch `/api/bootstrap`. If the window definition and
category registry are unchanged, do nothing: a reconnect must not flash or tear down a
display that is fine. If they differ, re-derive. Comparison is a structural compare of the
bootstrap payload, which is small and already JSON.

*Alternative rejected:* pushing config changes as a `layout` wire message only. That exists
and works for a live layout switch, but it cannot help a client that was disconnected when
the push happened — which is precisely the reconnect case.

### D6 — The wedge gets instrumentation and a reproduction attempt, not a speculative fix

With D4 in place, "the lane is wedged" and "nothing is arriving" become distinguishable
from the wall itself, which is the missing evidence in all three field reports. The work is
to reproduce with that visibility: drive the narration category past a terminal-sounding
message and watch whether events arrive-and-are-dropped or never arrive. The spec states
the requirement (a terminal message must not wedge a lane) so the behavior is pinned
regardless of which layer turns out to be at fault.

## Risks / Trade-offs

- **Resume becomes a second, subtly different delivery path that skips a zone gate.** →
  The tail buffer stores the same `DisplayEvent` objects, and the resume path reuses the
  identical `reaches()`/zone predicates `replay()` uses. Highest-stakes part of this
  change; it needs a test that a public client resuming across a private event never
  receives it.
- **A watchdog that is too eager flags a healthy wall as disconnected.** → Threshold is a
  multiple of the server's advertised heartbeat interval, and the state is advisory — it
  changes the strip, never the rendering.
- **Re-bootstrap on every reconnect adds a request storm during a flapping connection.** →
  The native retry is already 2 s; one small local fetch per open is negligible, and D5's
  diff means a flap costs nothing visible.
- **The wedge is not reproduced.** → Then this change ships the observability and says so.
  That is a real outcome, not a failure to hide: the next report will arrive with evidence.
- **Bounded retention gives a false sense of gap-free delivery.** → D2's explicit fallback,
  with a scenario, is the mitigation.

## Migration Plan

Additive and backward-compatible on the wire: `id:` is an optional SSE field that an older
client ignores, and a client that presents no `Last-Event-ID` gets exactly today's
behavior. No config, no runtime artifact format, and no producer contract changes. Rollback
is a revert.

## Open Questions

- Tail-buffer size: reuse the scroll ring's bound, or size it in seconds of heartbeat
  interval? Decide during apply against the observed reconnect duration (~13 min in the
  field report is well past any reasonable buffer, so the fallback path will be the common
  one — which argues for sizing the buffer small and making the fallback good).
- Whether the disconnected state should also gray the boxes, or only mark the strip.
  Leaning to the strip only: dimming content the operator may still be reading is a
  regression dressed as feedback.
