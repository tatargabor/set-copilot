## Why

`transcript-stitch` shipped the mechanism. Running it for real — across `consumer-f` and
`set-promo` — showed that the mechanism is the easy part. The work that actually recovered
the lost knowledge was judgement, and it lived entirely in one operator's head:

- **Finding the inputs.** The originating recording was named
  `2026-07-14-csakany-robi-copilot-raw-part1.jsonl` — not `transcript*`, so the directory
  scan skips it and only a glob finds it.
- **Reading the quality signal.** `guessed=0` means the reconstruction is exact.
  `guessed=322, glued=136` means most word boundaries were inferred and the result should be
  trusted much less. Nothing today says that out loud.
- **Spotting a state fault.** One runtime dir held a live-named `transcript.jsonl` with 539
  lines and no `capture.pid` — an entire meeting that was never handed over. Nothing reports
  that; it was noticed by accident.
- **Spotting an unfixable input.** In the originating recording the `system` channel carries
  **two** remote speakers talking over each other. The stitch faithfully interleaves them,
  because the speaker identity is not in the file. A reader who does not know this reads the
  jumble as one person's words.
- **The expensive step.** Reading the stitched transcript to find *what was said that never
  reached the notes*. That is the step that recovers the knowledge, and it costs a model pass
  over a whole meeting.

That last point is what forces the design. The expensive step must run **once per transcript,
ever** — like a migration. And a ledger cannot live in a prompt: a skill that is told
"remember you already did this" will eventually not remember. The record has to be written by
the engine, as a side effect of doing the work.

## What Changes

- **New recovery ledger (engine).** An append-only log recording, per transcript and per
  **step** (`stitch`, `review`), that the step ran: when, against which stitch algorithm
  version, and with what outcome. Files are identified by a **content fingerprint**, not by
  path — archival renames files and projects move them.
- **`set-copilot transcript` skips already-stitched inputs by default**, with `--force` to
  redo. A batch run over an archive becomes re-runnable without redoing work or clobbering
  reviewed output.
- **New `set-copilot recovery` command** — `status` (pending / done / done-under-an-older-version
  / claimed-but-unfinished), `claim`, `mark`, and `abandon`. `mark` is not bookkeeping after the
  fact: it is how a review's findings are **delivered**, so skipping the record means failing to
  deliver the work.
- **New `Stop` hook enforcing completion.** An open review claim stops a session from ending
  silently, feeding back that the caller must `mark` or `abandon`. Installed by `init` alongside
  `wall-mirror.sh` and gated on a marker file the same way, so it is inert outside a recovery
  session. This is the same lesson `wall-chat-mirror` learned the hard way: a prompt mandate
  measurably falls behind, so enforcement is structural. The hook **blocks**; it never records a
  review on the caller's behalf, because asserting a review that did not happen is the one failure
  that loses knowledge silently.
- **New `skills/transcript-recover/SKILL.md`** — the *content* workflow: discover transcripts
  (including non-conventional names), stitch what is pending, grade each result
  (**reliable / suspect / unusable**) from the ledger and `--stats`, then read the readable
  transcript for what never reached the notes, and mark the review done. Carries the two known
  limits — multiple speakers on one channel, and a rotation-split recording being two separate
  timelines.
- **New `skills/set-repair/SKILL.md`** — the *mechanical* workflow: orphaned `capture.pid`, a
  capture that never handed its transcript over, a stale `wall.pid`, an archive with no
  stitched artifacts. `doctor` probes the audio chain; this inspects runtime **state**. It ends
  by handing off: content review belongs to `/transcript-recover`.
- **`init` reports the new skills.** It already copies every directory under `skills/`, so the
  skills ship automatically; only its hardcoded summary line names them.

## Capabilities

### New Capabilities
- `recovery-ledger`: the migration semantics — an append-only, engine-owned record of which
  recovery steps have run against which transcript, keyed by content fingerprint and carrying
  the algorithm version; the default-skip behavior and the `--force` override; the `recovery
  status` / `recovery mark` surface.
- `transcript-recovery`: the content workflow — input discovery beyond the naming convention,
  the reliability grading of a stitched result, the named limits a reader must be told about,
  the "what never reached the notes" pass, and its once-only guarantee.
- `runtime-repair`: the mechanical workflow — detecting and reporting runtime-dir state faults
  (orphaned PID, unconsumed transcript, stale wall claim, unstitched archive), what may be
  fixed automatically versus only reported, and the handoff to content recovery.

### Modified Capabilities

None. The stop-time stitch gains its ledger entry through `recovery-ledger`'s "stitching records
itself" requirement — it runs through the same stitch path — so `meeting-transcript-persistence`
needs no requirement change and this change carries no archive-order dependency.

## Impact

- **New code**: `src/recovery-ledger.ts` (+ tests), `hooks/recovery-guard.sh`,
  `skills/transcript-recover/SKILL.md`, `skills/set-repair/SKILL.md`.
- **Modified**: `src/cli.ts` (`recovery` command, `--force`, skip logic, hook registration, help,
  init summary),
  `src/transcript-stitch-run.ts` (record entries as it writes), `src/index.ts` (exports),
  `CLAUDE.md`.
- **Unaffected**: the audio chain, the stitch algorithm itself, capture/poll, the wall, and the
  `/ds` / `/dd` dictation flow.
- **Dependencies**: none added — a fingerprint uses `node:crypto`.
- **Risk**: the ledger becomes a second source of truth about what was processed. It is
  advisory by construction — losing it costs redone work, never data, and the artifacts on
  disk remain the real evidence.
