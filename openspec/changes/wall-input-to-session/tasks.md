## 1. Pure module: src/wall/input.ts

- [ ] 1.1 `wallInputPath(runtimeDir)` → `<runtimeDir>/wall-input.jsonl`
- [ ] 1.2 `normalizeWallInput(raw)` → `{ok:true,text}|{ok:false,reason}`: trim, reject empty, cap 400 chars, reject any C0/C1 control character (newline/tab included); accented text and emoji pass

## 2. Server: POST /api/input

- [ ] 2.1 Route `/api/input` in `WallServer.handle` to a new `handleInput`; other methods → 405
- [ ] 2.2 Body read with a 4096-byte cap (413 past it), JSON `{route?, text}` parsed, text validated via `normalizeWallInput` (400 with the reason), no runtime dir → 503
- [ ] 2.3 Valid input appended as one `JSON.stringify({ts, route, text})` line (injectable `inputPath` on `WallServerOptions`; loopback-bind note in a comment); 204 on success; never broadcast to wall clients

## 3. Poll: the session side

- [ ] 3.1 Pure `wallInputsFrom(lines, last)` → `{texts, next}`, skipping blank/malformed lines — separate from the transcript's `filterLines` so an operator-typed line can never be swallowed as an echo
- [ ] 3.2 `runPoll` tails the file with a `wall-input-offset` state; pending inputs are checked inside the loop BEFORE `pollDecision` (drain-before-dead) and emitted `{"type":"wall-input","text":…}` with an immediate return; the transcript offset is untouched
- [ ] 3.3 Inputs also drain after the wait elapses, before the transcript lines, with the offset written

## 4. Wall lifecycle + client UI

- [ ] 4.1 `runWall` rotates a non-empty `wall-input.jsonl` aside (rename, timestamped) and writes `wall-input-offset = 0` at start
- [ ] 4.2 Strip form in `index.html` + `wall.js` (placeholder `Üzenet a copilotnak…`, button `Küldés`, Enter submits; `✓ elküldve` ~2 s on success, `✗ nem sikerült` on failure; no autofocus; POST `/api/input`), styled in `wall.css`, hidden with the strip

## 5. Policy + docs

- [ ] 5.1 SKILL.md batch contract: `{"type":"wall-input","text":…}` — the operator speaking from the wall, same priority as a fast-lane command, act on the EVENT never on a similar transcript line
- [ ] 5.2 `copilot-prompt.ts`: a compact wall-input section with the same rule
- [ ] 5.3 `docs/replay-harness.md`: `wall-input.jsonl` is a second harness-drivable file seam; scorer ignores it today; the offset resets at wall start

## 6. Tests

- [ ] 6.1 `src/wall/input.test.ts`: accepts plain/trimmed/accented/emoji; rejects empty, >400, newline, tab, NUL, DEL
- [ ] 6.2 `src/wall/server.input.test.ts`: POST appends one JSONL line (ts/route/text); second POST appends a second line; 405 on GET; 400 on control char and empty; 413 on oversized body; 503 without a runtime dir; `inputPath` injection works
- [ ] 6.3 `src/poll.test.ts`: `wallInputsFrom` over blank/malformed/valid mixes; offset beyond EOF yields nothing; a pending input is emitted before a `capture-dead` verdict when both are true
