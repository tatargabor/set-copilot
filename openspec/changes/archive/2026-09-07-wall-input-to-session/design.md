## Context

Every arrow in the system already converges on one file the session reads: the transcript
(`poll.ts` long-polls it with a byte-independent line-count offset in `poll-offset`, and
the meeting-copilot Monitor loop consumes what it prints). The wall server owns the runtime
dir (it tails `wall-events.jsonl`), binds `127.0.0.1`, and today accepts only GETs. The
replay harness's validity rests on the consumer being indistinguishable between capture and
replay — which is why a second *file seam* is the natural input channel: the harness can
append to it exactly as the server does.

## Goals / Non-Goals

**Goals:**

- A human at the wall can hand the session a short instruction with one interaction.
- The input reaches the session with command-class priority (no waiting behind the silence
  gate or the dwell bound).
- Harness-drivable: the same file seam a human's keystrokes produce is one the harness can
  write.
- Nothing about the input can impersonate a transcript line or a wall display event.

**Non-Goals:**

- No auth layer: the server binds loopback (`server.ts` `host ?? "127.0.0.1"`), which IS
  the operator-only guarantee; a future `--host 0.0.0.0` would expose this write path and
  must be a deliberate decision.
- No broadcast of the input to wall clients (the confirmation is client-side).
- No free-form chat: one line, 400 chars, no control characters.
- No scoring changes in the replay harness (noted as future work there).

## Decisions

**1. A separate `wall-input.jsonl`, not a transcript line.** Writing into the transcript
would (a) violate capture's ownership of its runtime files and the exactly-once handover,
(b) make an operator instruction indistinguishable from speech, and (c) drag it through the
echo-dedup — where a repeated instruction ("draw the wrong thing again") would be silently
swallowed as an echo of the first. A separate file with its own offset keeps the channels
apart and lets the policy say: act on the EVENT, never on a similar line.

**2. Validation is engine hygiene, not a config seam.** Trim, ≤ 400 chars, no C0/C1 control
characters (newlines included — one input is one JSONL line). This is the same altitude as
`DEFAULT_REDACTION.maxInputLength`: a shape bound, not project judgement. Accented
Hungarian and emoji must pass — the check is a control-character class, never `\b`-shaped.

**3. The offset is a line count, reset at wall start.** `poll-offset` already established
the byte-independent line-count format; `wall-input-offset` follows it. The trap the offset
creates: `wall-input.jsonl` outlives the wall process in the shared runtime dir, so an
offset from a previous meeting would suppress every message typed into the next one —
silently, with no error anywhere. So `runWall` rotates a non-empty input file aside
(rename, never truncate — the same discipline as the events log) and writes the offset to
`0`. Restarting the wall between meetings is the normal flow, so the reset rides it.

**4. Drain-before-dead, command-class early return.** The wall-input check runs inside the
poll loop BEFORE `pollDecision`, so a pending input is handed over even when the capture is
gone — the exact rule the transcript side paid for once (reporting dead before reading
discarded the closing minutes of a meeting). An input returns immediately at the next
250 ms tick, like a fast-lane command: it is an instruction, and the inference gate the
poll exists for has nothing to do here.

**5. The endpoint is the server's first POST, and deliberately boring.** Method check (405),
body byte cap (413 past 4096 — the client sends ≤ ~450), shape + validation (400), no
runtime dir (503, library/test use), then `appendFileSync` one line and answer 204.
Single-process server + append-only writes need no lock. The route lives beside the other
`/api/*` handlers; `WallServerOptions.inputPath` exists only so tests can point the append
at a temp file without a runtime dir.

**6. The confirmation is client-side, small, and honest.** The strip shows `✓ elküldve`
(~2 s) on 204, `✗ nem sikerült` otherwise. Echoing the text into the wall's text stream
would fake a display event and lie about who said it — the mirrored stream is the
copilot's voice, not the operator's keyboard. No autofocus: the page is a shared screen,
and stealing focus mid-meeting types a password into the copilot.

## Risks / Trade-offs

- [A stale `wall-input-offset` suppresses every future message] → handled by the rotate +
  reset at wall start; the same latent issue exists for `poll-offset` vs an archived
  transcript and is deliberately out of scope here.
- [Loopback is the entire security story] → stated at the endpoint; no auth knob now.
- [The skill could mistake the input's text for a transcript quote] → the event carries a
  distinct `type`, and both the skill and the rendered prompt state the act-on-the-event
  rule in the same words the fast lane uses.
- [Input text arrives while the copilot is mid-turn] → it queues in the file; the next
  poll hands it over. Order within the file is the order typed.

## Migration Plan

None: a new file and endpoint appear; nothing existing changes shape. Rollback = revert.

## Open Questions

None.
