## Context

`transcript-stitch` made a fragmented transcript readable. Running it across two real projects
showed the mechanism was never the bottleneck — the judgement around it was, and it lived in one
operator's head. Three things forced this design:

1. **The valuable step is expensive.** Finding what a meeting said that never reached the notes
   costs a model pass over a whole transcript. Doing it twice is pure waste, and doing it twice
   across a 258-file archive is prohibitive.
2. **A prompt cannot keep a ledger.** A skill instructed to "remember you already reviewed this"
   will eventually not remember — the same reasoning that made the wall's chat mirror a `Stop`
   hook rather than a prompt mandate, after a field meeting proved the prompt-only version fell
   behind. Durable state belongs to the engine.
3. **Some transcripts cannot be recovered, and saying so is the feature.** In the originating
   recording the `system` channel carried two overlapping remote speakers. The stitch interleaves
   them faithfully because the speaker identity is not in the file. Presenting that output as a
   transcript is worse than presenting nothing.

## Goals / Non-Goals

**Goals:**

- Make recovery re-runnable: run it over a project any number of times, and it does only the work
  that has not been done.
- Put the durable record in the engine, written as a side effect of doing the work.
- Grade every result, and name the conditions under which the output is not a faithful record.
- Split the two workflows that were tangled together: mechanical state repair, and content
  recovery.

**Non-Goals:**

- Improving the stitch algorithm. Two limits found in the field (multiple speakers per channel;
  missing recognizer punctuation) are reported here, not solved. Separating co-channel speakers
  needs diarization at capture time — a different change.
- A general migration framework. This is a ledger for recovery steps, not a schema-versioning
  system for the project.
- Automatic remediation of anything destructive. Repair reports; the operator decides.
- Replacing `doctor`. It probes the audio chain; `set-repair` inspects runtime state. They do not
  overlap.

## Decisions

### The ledger is append-only JSONL in the project root's runtime area

`<projectRoot>/.set/copilot/recovery-log.jsonl`, one JSON object per line: fingerprint, step,
timestamp, algorithm version, a path hint, and the step's outcome. Append-only, mirroring
`wall-events.jsonl` — the project's existing precedent for a log that is the rebuild source and
is rotated, never rewritten.

It lives at the **project root**, not in the per-session runtime dir, because recovery is a
cross-session activity: it reads every session's archive at once, and a per-session ledger would
answer the wrong question. It follows `cfg.projectRoot`, so recovering a recording that lives in
another repo records the fact in the project doing the recovering, which is where the next run
will look.

*Alternative rejected:* a marker file beside each transcript. It litters directories the operator
does not own (the originating recording lives in a sales repo), and it cannot record a step that
produced no artifact.

*Alternative rejected:* a rewritten JSON state file. It loses the history of what ran when, and a
partial write destroys the whole record rather than one line.

### The key is a content fingerprint, not a path

A transcript's path is not stable: the handover renames every file it archives, and recordings get
copied into other repos. A SHA-256 of the file contents is. The path is stored alongside as a
hint for a human reading the log, and is never used for matching.

This gives the right answers to the awkward cases for free: two copies of one recording are one
transcript; a file whose content changed is a new transcript.

*Cost:* hashing every candidate on every run. A transcript is at most a few MB and the archive is
a few hundred files — a full pass is well under a second, and it happens once per invocation.

### Default is skip; `--force` is the only way to redo

`set-copilot transcript` consults the ledger and skips inputs whose `stitch` step is recorded. The
user's framing was explicit: once fixed, do not fix again. `--force` performs the step and appends
a **new** entry rather than replacing the old one, so the history shows both.

### The algorithm version is recorded, but never triggers a redo

Each entry carries the stitch version. The stitch changed twice in the session that produced it —
the false-terminator rule and the merged-sentence cap — and each change would have invalidated
every prior result under a "redo when stale" policy.

So a stale entry still counts as done. What the system does instead is **report**: "12 transcripts
were recovered with an older stitch version." The operator decides whether that is worth a
`--force`. This keeps the default honest (never surprise work, never surprise cost) while making
the staleness visible rather than silent.

*Alternative rejected:* auto-redo on version bump. It turns a patch release into an unbounded
model-pass bill across every project's archive.

### Recording the review is enforced in three layers, not asked for

Stitching records itself, because the engine does it. The review pass is done by a model, so the
engine cannot detect its completion — and the first draft of this design accepted that a skill
might simply forget to record it, reasoning that the failure direction was safe (the transcript
stays pending and gets reviewed again).

That is not good enough, and this repo already has the evidence. The chat→wall mirror began as a
prompt mandate — *policy asking the copilot to mirror* — and a live meeting measured it falling
behind badly enough that it had to be rebuilt as a `Stop` hook (`hooks/wall-mirror.sh`), whose
own comment records the lesson: "Why a hook and not agent discipline… that policy repeatedly fell
behind. This hook closes the gap structurally." A recovery review is a worse case than a mirror
line: forgetting it means re-reading a whole meeting, or — if the operator trusts a stale status —
losing the same knowledge a second time.

So three layers, weakest to strongest:

1. **Structural — the record carries the result.** `recovery mark … --step review` is not
   bookkeeping after the fact; it is how findings are delivered (`--findings-file`, or stdin).
   Forgetting to record therefore means failing to deliver the work, which is self-correcting.
   There is deliberately **no** supported path that produces findings without writing the record —
   the same shape as `wall-emit`, where the model supplies content and the engine owns the durable
   side effect.
2. **Visible — a claim marks the attempt.** `recovery claim <file> --step review` runs before the
   read. An interrupted review is then reported as *claimed but unfinished*, a state distinct from
   both pending and done, and prominent in `recovery status`. A claim is never a completion.
3. **Enforced — an open claim gates the turn.** A `Stop` hook refuses to let a session end
   silently while a claim is open, feeding back that the caller must either `mark` or
   `recovery abandon`. Installed by `init` next to `wall-mirror.sh` and gated on a marker file the
   same way, so it is inert for every session that is not recovering.

Layer 3 is the actual guarantee; layers 1 and 2 make the correct path the easy one, and keep the
system honest when the hook is absent. Because it *can* be absent — a project that never ran
`init` has no hook — the recovery skill checks for it and says so, rather than letting the
operator assume a bookkeeping guarantee that is not installed.

*Alternative rejected:* having the hook mark the review complete automatically at end of turn. It
would record a review that may not have happened, which is the one failure that loses knowledge
silently. The hook blocks; it never asserts.

*Alternative rejected:* a lease with a timeout that auto-abandons. A stale claim is information —
it says a review was attempted and interrupted — and expiring it quietly throws that away.

### Two skills, because the two jobs have different costs and different failure modes

`set-repair` is mechanical, cheap, and safe to run often. `transcript-recover` is a content pass
that costs a model read per transcript. Merging them would either make the cheap check expensive
or bury the expensive step inside something that looks routine. They compose instead: repair ends
by reporting how many transcripts remain unreviewed and naming the content workflow.

### Grading is derived, not invented

The grade comes from numbers the stitch already produces:

- **reliable** — no boundary was guessed (a post-`a30d12f` recording).
- **suspect** — a meaningful share of boundaries was inferred, some joined without a separator.
  Measured on a real legacy recording: `guessed=322, glued=136` out of 891 segments.
- **unusable** — the channel structure shows more than one speaker interleaved, so the text is
  not a faithful record of any single speaker.

The exact thresholds belong in the skill (they are judgement), not in engine code.

## Risks / Trade-offs

- **The ledger drifts from reality** (files deleted, artifacts removed by hand) → It is advisory:
  a missing ledger means "everything pending", a corrupt line is skipped, and the artifacts on
  disk stay the real evidence. Worst case is repeated work.
- **A fingerprint hides a re-recorded meeting** — two different meetings can never collide, but a
  transcript edited by hand becomes "new" and gets re-reviewed → Correct behavior; edited content
  is content that has not been reviewed.
- **`--force` across a large archive is expensive** → The report states how many transcripts a
  force would touch before it is run.
- **A skill forgets to `mark`** → Addressed structurally rather than accepted: findings are
  delivered *through* `mark`, a claim makes an unfinished review visible, and a `Stop` hook
  refuses to end the turn on an open claim. Where the hook is not installed the residual risk
  remains, so the skill reports that state instead of implying a guarantee it does not have.
- **The hook blocks a turn the operator wanted to end** → `recovery abandon` is always available
  and is one command; the hook names it in the message it feeds back. It gates on a marker file,
  so it is inert outside a recovery session.
- **`set-repair` touching a live capture** → It verifies liveness with a signal-0 probe before
  reporting a claim stale, and never acts on a dir with a running capture or wall. The existing
  runtime-dir invariants (exactly-once handover, refusing a second capture, rotating rather than
  truncating the wall log) are reused, never re-implemented.

## Migration Plan

Additive; nothing existing changes shape.

- **Rollout**: ship the ledger and the commands; the first `transcript` run in a project creates
  the log. Transcripts stitched before this change have no entry, so the first recovery run treats
  them as pending — correct, since they were never reviewed either.
- **Existing artifacts**: a transcript already stitched by hand gets re-stitched once (cheap,
  idempotent output) and then recorded. No `.md` is lost — the stitch overwrites with identical
  content.
- **Rollback**: delete `recovery-log.jsonl`. Behavior returns to always-process, and no data is
  affected.

## Open Questions

- Should `recovery status` read a whole archive across projects (a `--all` over known runtime
  dirs), or stay per-project? Starting per-project: cross-project discovery needs a registry that
  does not exist yet.
- Does the review step want a finer outcome than done/not-done — e.g. "reviewed, N findings" — so
  a later run can resurface findings without re-reading? Recording the finding count in the entry
  is cheap and leaves that door open; the findings themselves stay out of the ledger.
