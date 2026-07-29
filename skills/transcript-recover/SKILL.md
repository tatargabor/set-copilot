---
name: transcript-recover
description: Recover knowledge from recorded meetings — stitch pending transcripts, grade them, and find what was said that never reached the notes
user_invocable: true
---

# transcript-recover — content recovery from recorded meetings

The mechanical half (stitching) is cheap and the engine does it. **The expensive half is
reading a whole meeting to find what was said that never reached the notes** — that costs a
model pass per transcript, and it must happen **once per transcript, ever**.

That is why this skill does not decide from memory what has been done. `set-copilot recovery`
holds the record, in the engine, written as a side effect of doing the work. Consult it first,
act only on what is pending, and deliver findings *through* it.

For the mechanical state faults instead — an orphaned PID, a capture that never handed its
transcript over, a stale wall claim — use `/set-repair`. It is cheap and safe to run often.

## Phase 1 — discovery

Find candidate transcripts. Three places, and the third is the one that gets missed:

1. **Per-session runtime dirs**: `.set/copilot/*/` under the project.
2. **The global runtime dir** if this project ever ran without `SET_COPILOT_DIR` (`/tmp/set-copilot`).
3. **Hand-filed recordings.** A recording saved by a human is usually *not* named
   `transcript*` — a real one was `2026-07-14-csakany-robi-copilot-raw-part1.jsonl`. The
   directory scan only knows the capture's own naming convention, so a file like that needs an
   explicit glob: `--input 'recordings/*.jsonl'`.

Two things that look like transcripts and are not:

- `wall-events.jsonl` — the wall's event log. Never a transcript.
- `*-stitched.jsonl` — this workflow's own output.

## Phase 2 — what is actually pending

```bash
set-copilot recovery status --json                    # the project's runtime dirs
set-copilot recovery status --input '<dir-or-glob>' --json
```

Read `pending.stitch`, `pending.review`, `artifactsOnly`, `dangling`, `staleStitch` and
`hookInstalled`.

- **`artifactsOnly` is stitched, but by an unknown version.** The `.md` and `-stitched.jsonl`
  are on disk with no ledger entry — that is every recording made before the ledger existed.
  Phase 3 restitches them (which is what puts them in the ledger); their **review** status is
  unaffected and is the one that decides whether the expensive read still has to happen.

- **Act only on `pending`.** A transcript whose `review` is `done` has already had the
  expensive read. Do not repeat it. If the operator wants it redone anyway, that is their
  explicit call.
- **Resolve `dangling` first.** A dangling entry is a review someone started and did not
  finish. Either finish it (claim → read → mark) or `recovery abandon` it with a reason. Do
  not start new work on top of an unresolved claim.
- **`staleStitch` is information, not a task.** It lists transcripts stitched under an older
  algorithm version. Report the count; re-stitch only if the operator asks (`--force`).
- **If `hookInstalled` is false, SAY SO** in your first message: this project never ran
  `set-copilot init`, so nothing enforces that an interrupted review is recorded. The operator
  must not assume a bookkeeping guarantee that is not installed.

Then mark the session as recovering, so the completion guard is live:

```bash
touch "$(set-copilot path runtime)/recovery.active"
```

Remove it when you finish:

```bash
rm -f "$(set-copilot path runtime)/recovery.active"
```

## Phase 3 — stitch what is pending

```bash
set-copilot transcript --input '<dir-or-glob>' --stats
```

Already-stitched inputs are skipped automatically. Keep each file's `--stats` line — the
grade in the next phase is derived from it.

## Phase 4 — grade every result before reading it

The numbers come from the engine; the thresholds are judgement and live here.

| grade | condition | what it means |
|---|---|---|
| **reliable** | `guessed=0` | Every word boundary came from the capture's own `cont`/`midWord` markers. The text is what was said. |
| **suspect** | `guessed` is a meaningful share of `segments` (say >10%), especially with `glued>0` | Boundaries were inferred. Individual words may be wrong. Quote from it, but say the grade next to the quote. |
| **unusable** | more than one speaker interleaved on one channel | The text is not a faithful record of *any* single speaker. Do not quote it as if it were. |

Measured on a real legacy recording: `guessed=322, glued=136` of 891 segments — squarely
suspect. A post-fix recording reads `guessed=0`.

**State the grade for every file, including the reliable ones.** "This one is exact" is an
answer the operator needs as much as "this one is guesswork".

## Phase 5 — the two limits you must name

Both are properties of the *recording*, not bugs to fix here. A reader who is not told about
them reads a jumble as one person's words.

1. **More than one speaker on a channel.** The `system` channel carries whatever the machine
   played, so two remote participants talking over each other land on it as one speaker. The
   stitch interleaves them faithfully, because the identity is simply not in the file. Spot it
   by: fragments that alternate between two voices mid-topic, an unusually high
   `guessed`/`glued` count, and sentences that contradict themselves within a few lines. When
   you see it, grade the file **unusable** and say why — separating them needs diarization at
   capture time, which no amount of reading will recover.
2. **A recording split across files is two timelines, not one.** A capture that rotated at its
   duration limit restarts its timestamps from zero. Each file is stitched on its own timeline;
   `part1` and `part2` are not continuous, and a timestamp in one means nothing in the other.
   Quote timestamps with their file.

## Phase 6 — the review pass

For each **pending** transcript, in this order:

```bash
set-copilot recovery claim <file> --step review
```

Claim **before** reading. If the read is interrupted, the claim is what makes it visible as
unfinished rather than silently pending-again.

Then read the stitched `.md` against the project's notes and knowledge base
(`knowledge.sources`, decisions, the digest) and answer one question:

> **What was said in this meeting that never reached the notes?**

For each finding: the quote, its timestamp, why it matters, and — if the file is not
`reliable` — the grade's caveat attached to that quote.

Deliver the findings by recording them:

```bash
set-copilot recovery mark <file> --step review --findings-file findings.json
# or:  echo '[…]' | set-copilot recovery mark <file> --step review
```

`findings.json` is a JSON array; `[]` is a legitimate result meaning "nothing was missed" and
must still be recorded. **The report you show the operator is derived from what you submitted**
— do not write a report alongside the record, because then the two can disagree, and the record
is what the next run will trust.

If a review cannot be finished, end it explicitly:

```bash
set-copilot recovery abandon <file> --step review --reason "…"
```

Never leave a claim hanging.

## Phase 7 — output shape

1. **Grade table** — one row per file: name, grade, `segments/sentences`, `guessed/glued`, and
   the stitch version if it is stale.
2. **Findings** — grouped by file, each with quote, timestamp, why it matters, and the caveat.
3. **What remains** — pending transcripts not reached this run, unresolved claims, and whether
   the completion hook is installed.

## Rules

- Never re-review a transcript the ledger reports as done.
- A claim is not a completion. Never report a claimed transcript as reviewed.
- Never present an **unusable** transcript's text as a record of what someone said.
- Report in the language of the project's notes.
- The ledger is advisory: if it disagrees with what is on disk, the artifacts on disk are the
  evidence. Say so rather than silently trusting either one.
