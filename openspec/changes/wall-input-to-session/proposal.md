## Why

The wall is strictly one-directional: the browser sends exactly two GETs (bootstrap + SSE),
all viewer interaction is local (splitters, graph zoom), and no path exists from a human at
the wall into the Claude session — the session's only inbound channel is the transcript.
The operator asked for exactly this in the dictated work order ("tudjak bevinni" — be able
to input things from the wall). A small, file-seam input path makes the wall genuinely
two-directional and stays harness-drivable (the replay harness can append to the same
file).

## What Changes

- The wall page gets a small message box in the status strip (Hungarian UI strings, per
  convention): type, Enter or `Küldés`, a transient `✓ elküldve` confirms. No autofocus —
  the wall is a shared screen.
- New `POST /api/input` on the wall server (its first POST; everything else is GET): body
  capped at 4096 bytes, text validated (trim, ≤ 400 chars, no control characters), then
  appended as one JSON line to `<runtimeDir>/wall-input.jsonl`. The server binds
  `127.0.0.1`, which is the whole security story — loopback is operator-only by
  construction.
- `poll` grows a second tailed file: `wall-input.jsonl` with its own `wall-input-offset`
  state, emitting `{"type":"wall-input","text":…}` with the same early-return priority as
  a fast-lane command, and checked before the `capture-dead` verdict (drain-before-dead).
- `wall` start rotates a non-empty `wall-input.jsonl` and resets the offset — a stale
  offset would silently swallow every future message (the one real trap in this feature).
- Policy: the skill and the rendered prompt teach that a `wall-input` event is the operator
  speaking from the wall — same priority as a fast-lane command; act on the EVENT, never on
  a similar transcript line.
- The input is the viewer seam, not a display event: it is NOT broadcast to wall clients
  and never enters `wall-events.jsonl`.

## Capabilities

### New Capabilities

- `wall-input`: the wall→session input path — the page's message box, the server's
  validation + append, and the poll side that hands the text to the session as an event.

### Modified Capabilities

(none — `transcript-poll` gains a second input file, but the poll's transcript contract
(the drain-before-dead order, the offset discipline, the early-return classes) is extended,
not changed; the new behavior is specified by the new capability.)

## Impact

- New `src/wall/input.ts` (`wallInputPath`, `normalizeWallInput`); `src/wall/server.ts`
  (first POST route + handler, injectable `inputPath`); `src/poll.ts` (second offset file,
  `wallInputsFrom`, in-loop drain); `src/wall/index.ts` (rotate + reset at start);
  `src/wall/public/{index.html,wall.js,wall.css}` (the strip form); `skills/meeting-copilot/SKILL.md`;
  `src/copilot-prompt.ts`; `docs/replay-harness.md`.
- Tests: new `src/wall/input.test.ts`, `src/wall/server.input.test.ts`; `src/poll.test.ts`
  additions.
- No change to `wall-events.jsonl` producers, the SSE vocabulary, redaction, or the
  transcript handover invariants.
