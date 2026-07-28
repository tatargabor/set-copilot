## 1. Resumable delivery (server)

- [ ] 1.1 Give the server run an identity and a monotonic counter; write `id:` on every broadcast line alongside `data:` (D1/D2).
- [ ] 1.2 Add a bounded tail buffer of broadcast `DisplayEvent`s, sized per the design's open question, reusing the scroll ring's bounding discipline.
- [ ] 1.3 In `handleSse`, read `Last-Event-ID`; when it belongs to this run and is still retained, stream the missed tail through the **same** zone/category predicates `replay()` uses (`reaches()`, `isPublicClient`, the `visual`-id guard) — no second gate implementation (D3, risk 1).
- [ ] 1.4 When the id is from another run, is unretained, or absent, fall back to the full `replay()` and mark the message so the client can rebuild rather than append (D2/D3).
- [ ] 1.5 Tests: a resume delivers exactly the missed span; a public client resuming across a private event never receives it; an unretained id falls back; a restarted run forces the fallback.

## 2. Transport liveness (client)

- [ ] 2.1 Add a pure `connectionState({ lastHeartbeatAgeMs, readyState, heartbeatIntervalMs })` to `wall-core.mjs` returning the strip's state, with the threshold derived from the server's advertised interval, never hardcoded twice (D4).
- [ ] 2.2 Unit-test it: healthy, gap just under threshold, gap over threshold, error state, recovery — and that a capture-stopped heartbeat is not masked by a healthy connection.
- [ ] 2.3 Wire a heartbeat-arrival watchdog plus `onerror`/`onopen` into `connect()` (`wall.js:65-77`) and render the disconnected state in the status strip.
- [ ] 2.4 Style the disconnected state in `wall.css` — strip only, do not dim box content (design open question).

## 3. Re-bootstrap on reconnect

- [ ] 3.1 Move the `/api/bootstrap` fetch so it runs on every stream open, not only in `boot()` (`wall.js:13-21`).
- [ ] 3.2 Structurally compare the new bootstrap against the mounted one; re-derive only on a difference, so a reconnect never flashes an unchanged display (D5).
- [ ] 3.3 Verify by changing a window's box subscriptions while a wall is open, then forcing a reconnect.

## 4. The narration wedge

- [ ] 4.1 With the new visibility in place, attempt the reproduction: drive the narration/text category past a terminal-sounding message and record whether events arrive-and-are-dropped or never arrive (D6).
- [ ] 4.2 If a cause is found, fix it here and add the regression test.
- [ ] 4.3 If it is not reproduced, record what was tried and what the instrumentation now shows, in the change and in the field backlog — do not close the backlog item silently.

## 5. Verify

- [ ] 5.1 `npm run build` clean under `tsc` strict; `npm test` green.
- [ ] 5.2 Run the wall, kill the server, and confirm the strip shows disconnected within the threshold — distinct from quiet.
- [ ] 5.3 Restart the server and confirm the client recovers with no reload, and that the scroll lane contains no duplicated line.
- [ ] 5.4 Broadcast events while a client is disconnected, reconnect, and confirm the missed events appear exactly once.
- [ ] 5.5 Force an unsatisfiable resume (restart the server) and confirm the fallback rebuilds rather than appends.
- [ ] 5.6 With a public and a private window open, disconnect the public one across a private event and confirm it never receives it on resume.
