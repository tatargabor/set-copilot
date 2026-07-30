## 1. Transcript reading (pure, unit-tested)

- [x] 1.1 Add `src/mirror-follow.ts` with a pure `parseMirrorables(chunk, carry)` that takes a
      transcript chunk plus any partial trailing line and returns `{ messages, carry }` —
      `type: "assistant"` entries, content blocks of `type: "text"`, `isSidechain !== true`,
      carrying `uuid`, `timestamp`, and the text (D5)
- [x] 1.2 Tests: a partial trailing line is buffered until its newline arrives; thinking and
      tool_use blocks are skipped; a sidechain entry is skipped; a malformed JSON line is skipped
      without throwing; several text blocks from one turn come back in file order
- [x] 1.3 Add `resolveTranscriptPath({ explicit, sessionId, cwd })` — explicit flag, then the
      `~/.claude/projects/<slug>/<id>.jsonl` convention, then a glob by session id; returns a
      reason when it finds nothing (D2)
- [x] 1.4 Tests for `resolveTranscriptPath` over a temp dir: convention hit, glob hit after the
      slug does not match, and the not-found reason naming `--transcript`

## 2. Policy reuse, block chunking, and fencing

- [x] 2.1 Extract the body of `cmdMirrorPolicy --apply` into an exported pure
      `applyMirrorPolicy(text, policy)` returning `{ decision: "emit" | "short" | "filler",
      chunks }`; make the CLI subcommand a thin wrapper over it so there is still one
      implementation (D6). *(Built with `chunks` and no `"truncated"` verdict: length control
      divides rather than truncates, so truncation is no longer a decision the policy returns —
      only an oversized single block is cut, inside the chunker.)*
- [x] 2.2 Replace the character-count cap with **block-boundary chunking**: split a long message
      into an ordered list of chunks, each carrying whole blocks (paragraph / list / table / fenced
      block / heading) and each within the budget; cut a single oversized block only as a last
      resort, marking it and closing its fence if it is a code block (D7)
- [x] 2.3 Tests: a message under the budget yields exactly one byte-identical chunk; a boundary
      never lands inside a table or a fence; nine list items across several chunks lose none of the
      nine; an unterminated fence never reaches the output; chunk order is stable
- [x] 2.4 Add `fenceAlignedBlocks(text)`: fence an unfenced block that carries box-drawing
      characters or column alignment across three or more lines; leave fenced content, prose, lists
      and markdown tables alone (D11)
- [x] 2.5 Tests for `fenceAlignedBlocks`: a box-drawing table is fenced; an already-fenced block is
      unchanged (no double fence, no re-indent); a prose paragraph and a markdown table are not
      fenced; a two-line coincidence is not fenced
- [x] 2.6 Verify `mirror-policy --apply` still exits 3 for a filler verdict and 0 with the text
      otherwise (existing callers and scripts depend on the codes)

## 3. The follower process

- [x] 3.1 `set-copilot mirror-follow [--transcript <path>] [--session <id>]`: resolve the
      transcript, take ownership of the runtime dir (`mirror.pid`), and follow with `fs.watch`
      plus a 250 ms safety `stat` poll, reading incrementally from `mirror-offset` (D3)
- [x] 3.2 Self-gate per message on `wall.pid` + `wall-mirror.enabled`, fence aligned blocks, chunk,
      apply the policy in-process, dedup against `wall-mirror.last`, and emit each chunk with
      `wall-emit`-equivalent `{category, zone:"both", text}` through the same funnel — no direct
      client write (spec: "The follower cannot bypass redaction")
- [x] 3.3 Advance `mirror-offset` and the dedup stamp **only after a confirmed emit**; log a failed
      emit with its error and retry it — never `|| true` (D12). On a transcript shorter than the
      recorded offset, resume at EOF and log the discontinuity (D4)
- [x] 3.4 Refuse a second follower whose `mirror.pid` names a live process; reclaim a stale PID
      file; remove the PID file on clean exit
- [x] 3.5 Tests for the pure parts: offset advance across chunk boundaries, the truncation-resume
      rule, the live-vs-stale PID decision (the process/watch parts are verified by running the CLI,
      per the repo's testing convention)

## 4. Observability

- [x] 4.1 Append one `wall-mirror.log` line per considered message — timestamp, uuid, decision,
      offset — with line-count-bounded rotation to `wall-mirror-<ts>.log`, rotating never
      truncating (D9)
- [x] 4.2 Extend `doctor --mirror` (and `src/diagnostics.ts`) to report the four states: wall
      running, opt-in marker present, follower process alive, last emission time — and name the
      command that starts the follower when it is missing
- [x] 4.3 Report an orphaned `mirror.pid` in the runtime-repair path alongside the orphaned
      capture PID
- [x] 4.4 Test the diagnostics over a fabricated runtime dir for each of the four states,
      including "opted in, wall running, no follower"

## 5. Lifecycle and hook retirement

- [x] 5.1 `stop` **drains** the follower (deliver what the transcript already holds) before the wall
      goes down, then terminates it and removes `mirror.pid`; report anything undelivered instead of
      exiting as if it had gone out (D13)
- [x] 5.2 Start the follower from the mirroring opt-in path, and make that path refuse to record
      the opt-in unless the follower is running — reporting the command that starts it (spec:
      "Enabling without a working delivery mechanism fails loudly")
- [x] 5.3 `init`: stop registering `wall-mirror.sh`, and idempotently **de-register** a previously
      added mirror-hook entry, touching only that entry and leaving `recovery-guard.sh` alone (D1)
- [x] 5.4 Test the de-registration: an unrelated `Stop` hook survives, a malformed settings.json is
      left untouched with a warning, a second run is a no-op
- [x] 5.5 Delete `hooks/wall-mirror.sh` and drop it from the packaged files list

## 6. The `heading` block on the wall

- [x] 6.1 Add a `heading` block to `text-format.mjs`'s closed union (level + inline children), build
      it in `text-render.mjs`, and style it in `wall.css` — distinguishable from a bold paragraph,
      not dominating the box at 1920×1080 (D10)
- [x] 6.2 A `#` inside a fenced code block or mid-paragraph SHALL NOT become a heading; move
      `"# not a heading"` out of `text-format.test.ts`'s literal-degradation list and assert the new
      intent there instead
- [x] 6.3 Assert `NODE_TYPES` still carries no raw/HTML variant after the addition (the existing
      structural safety test must keep passing unchanged)

## 7. Contract and skills

- [x] 7.1 Render a mirror block in `set-copilot prompt` from the resolved `copilot.mirror` —
      code-block handling, the chunk budget, category — so the copilot reads the policy that is
      running (D8)
- [x] 7.2 Rewrite `skills/meeting-copilot/SKILL.md:32`: the mechanism is the follower, not the Stop
      hook; delete the stale "strips code blocks, skips short filler (<40 chars)" claim
- [x] 7.3 State the latency floor and the chunking behaviour where an operator will read it (skill +
      `prompt` output): delivery is per completed message, not per token, and a long message arrives
      as consecutive chunks
- [x] 7.4 Update `CLAUDE.md`'s wall section — the mirror is a follower with an offset, a chunker and
      a log; the "chat→wall mirror became a Stop hook" lesson keeps its point while naming its
      successor **and** the corrected diagnosis (one message behind, not silently stopped)

## 8. Verification

- [x] 8.1 `npm run build` and `npm test` clean
- [x] 8.2 Live check with a real wall: start capture + wall + mirroring, produce a turn with two
      text blocks separated by a tool call, and confirm both reach the wall — the first before the
      turn ends
- [x] 8.3 Measure the acceptance bar: the delay between the transcript append and the wall event for
      a sample of messages, reported in the change; confirm it is within the 500 ms budget and that
      no message waits for a turn boundary
- [x] 8.4 Replay the field message that never arrived (the 2143-character nine-item report) through
      the follower and confirm **all nine items** reach the wall, headings rendered as headings
- [x] 8.5 Send an unfenced ASCII/box-drawing table and confirm it arrives fenced and monospace
      without the copilot being asked to fence it
- [x] 8.6 Kill the follower mid-session and confirm `doctor --mirror` reports it dead rather than the
      wall simply going quiet
- [x] 8.7 Stop a session right after a closing summary and confirm the summary is on the wall

## Measured (task 8.3 / 8.4, live wall on a scratch runtime dir, 2026-07-30)

| what | result |
|---|---|
| transcript append → wall event | **16 ms** (budget: ≤ 500 ms) |
| the field message that was lost (2143 chars, 9 items) | **9 / 9 items** on the wall, across 5 chunks |
| an unfenced box-drawing table | fenced automatically, 1 event, monospace |
| a short acknowledgement | suppressed, logged as `short` |
| `doctor --mirror` | four states + last emission; exits non-zero with the start command once the follower is killed |
| a second follower | refused, naming the live pid |
| two text blocks around a `tool_use` | two separate events, the `tool_use` skipped |
| closing summary written with no follower running | `wall-stop` drained it BEFORE stopping the wall ("Mirrored 1 pending message(s) before shutdown") |

Note on 5.5: `hooks/wall-mirror.sh` is deleted; `package.json`'s `files` lists the `hooks`
directory (not individual scripts), which still ships `recovery-guard.sh` — so there was nothing
to remove there.

Note on 8.2: verified in the sharper form the mechanism actually claims — a message appended to
the transcript reached the wall in 16 ms with **no turn boundary existing at all**, and two text
blocks separated by a `tool_use` arrived as two independent events.
