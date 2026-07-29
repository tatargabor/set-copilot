## 1. Resumable delivery (server)

- [x] 1.1 Give the server run an identity and a monotonic counter; write `id:` on every broadcast line alongside `data:` (D1/D2).
- [x] 1.2 Added a bounded tail buffer (200 broadcasts). Sizing decision, per the design's open question: **small**, because the observed field disconnection was ~13 minutes — far past any sane buffer — so the fallback is the common path and is what got the care (an announced full replay the client rebuilds from). Heartbeats are excluded from the tail and from id numbering: at 1/s they would evict it within seconds and pin every cursor to a message worth nothing on resume.
- [x] 1.3 In `handleSse`, read `Last-Event-ID`; when it belongs to this run and is still retained, stream the missed tail through the **same** zone/category predicates `replay()` uses (`reaches()`, `isPublicClient`, the `visual`-id guard) — no second gate implementation (D3, risk 1).
- [x] 1.4 When the id is from another run, is unretained, or absent, fall back to the full `replay()` and mark the message so the client can rebuild rather than append (D2/D3).
- [x] 1.5 Tests: a resume delivers exactly the missed span; a public client resuming across a private event never receives it; an unretained id falls back; a restarted run forces the fallback.

## 2. Transport liveness (client)

- [x] 2.1 Add a pure `connectionState({ lastHeartbeatAgeMs, readyState, heartbeatIntervalMs })` to `wall-core.mjs` returning the strip's state, with the threshold derived from the server's advertised interval, never hardcoded twice (D4).
- [x] 2.2 Unit-test it: healthy, gap just under threshold, gap over threshold, error state, recovery — and that a capture-stopped heartbeat is not masked by a healthy connection.
- [x] 2.3 Wire a heartbeat-arrival watchdog plus `onerror`/`onopen` into `connect()` (`wall.js:65-77`) and render the disconnected state in the status strip.
- [x] 2.4 Style the disconnected state in `wall.css` — strip only, do not dim box content (design open question).

## 3. Re-bootstrap on reconnect

- [x] 3.1 Move the `/api/bootstrap` fetch so it runs on every stream open, not only in `boot()` (`wall.js:13-21`).
- [x] 3.2 Structurally compare the new bootstrap against the mounted one; re-derive only on a difference, so a reconnect never flashes an unchanged display (D5).
- [x] 3.3 Verify by changing a window's box subscriptions while a wall is open, then forcing a reconnect.

## 4. The narration wedge

- [x] 4.1 Attempted against a real wall driven through a real browser over CDP: a terminal-sounding narration line, then follow-ups — all rendered. Repeated with an empty text, a bare "Vége.", an 8 KB line, and an explicit "a wall leáll" line; the lane kept rendering every subsequent event. **Not reproduced**: no event content puts a text box into a non-accepting state in the current code.
- [x] 4.2 If a cause is found, fix it here and add the regression test. **No cause found** — nothing to fix, so no speculative change was made. The requirement is pinned by the spec regardless of which layer would turn out to be at fault.
- [x] 4.3 Recorded in `docs/wall-field-backlog.md` P0 #1, explicitly left OPEN, with what the new instrumentation makes distinguishable (strip says disconnected → it was the transport; strip says listening while the box is frozen → a genuine render-side wedge) and an instruction not to close it on the strength of a non-reproduction.

## 5. Verify

- [x] 5.1 `npm run build` clean under `tsc` strict; `npm test` green.
- [x] 5.2 Verified in a real browser over CDP, against a stream that is ACCEPTED but silent — a harder case than killing the server, and the one the field actually reports: at t≈9s the strip read `⛔ nincs kapcsolat a fallal` / `status-disconnected`, distinct from the `status-listening` it showed at t≈2s.
- [x] 5.3 Verified over CDP: when the stream resumed the strip returned to `🎙 figyelek` with no reload, and the document title changed `ELSŐ` → `MÁSODIK`, proving the reconnect re-bootstrapped and adopted a changed window definition (also 3.3).
- [x] 5.4 Covered by `server.resume.test.ts` over the real HTTP/SSE path: a client disconnects, two events are broadcast, it reconnects with its cursor and receives exactly `["three","four"]` — no re-run of what it already had, no gap.
- [x] 5.5 Covered by `server.resume.test.ts`, both unsatisfiable branches: another run's id, and a genuinely evicted cursor (260 broadcasts past a 200-entry tail). Both produce the announced `{"kind":"replay","mode":"full"}`, which the client handles by clearing every box before applying — rebuild, not append.
- [x] 5.6 Covered by `server.resume.test.ts`: a public client resuming across a private event never receives it, and the `both` event it does receive is still the REDACTED variant — resume goes through the same gates as the live broadcast rather than a second copy of them.
