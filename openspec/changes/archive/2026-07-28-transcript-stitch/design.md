## Context

The capture writes a transcript line when a sentence ends, when *that speaker* falls silent
for 3s, or when 80 tokens accumulate. None of those are meaning boundaries. With two
channels the fragments interleave, and before `a30d12f` a cross-channel interjection cut a
line wherever the token stream happened to stand — mid-word. `a30d12f` stopped the
cross-channel cut and added `startTs` / `partial` / `cont` / `midWord` so the remaining
boundaries would be *reversible*. It did not add anything that reverses them, and it does
nothing for the 258 already-archived transcripts.

A working reference implementation exists:
`~/code/consumer-c/scripts/meeting-transcript-build.mjs` (276 lines, plain JS, zero
dependencies), written ad hoc and proven on real recordings. This change ports it into the
engine rather than reinventing it.

The relevant constraints from `CLAUDE.md`:

- Everything project-specific is config, not code. A Hungarian function-word list hardcoded
  in `src/` would be exactly the leak the config seams exist to prevent.
- Word boundaries are Unicode (`\p{L}\p{N}`), never `\b` — `\b` treats `á` as a boundary.
- A transcript is handed over exactly once; archival renames, never truncates.
- Tests cover pure logic only. The stitch touches no audio, so it is fully unit-testable.
- No client transcript may enter the repo (`docs/PRE-PUBLISH.md`).

## Goals / Non-Goals

**Goals:**

- Turn a fragmented transcript back into whole sentences, using the capture's own
  `cont`/`midWord` evidence where it exists and a bounded heuristic where it does not.
- Make the readable transcript the artifact that is *at hand* after a meeting, not one that
  someone has to remember to generate.
- Make the existing archive backfillable in one run per project.
- Keep the engine language- and project-neutral: the word list, the speaker names, and the
  stop-time gate are configuration.
- Be honest about reconstruction quality: report exact vs. guessed boundaries, and mark
  transcription holes rather than smoothing over them.

**Non-Goals:**

- Changing `transcript-writer.ts`. The line shape and flush rules stay as they are; this is
  a consumer-side step. Trying to make the writer emit sentences would require holding a
  buffer past its silence bound and would break the live copilot's latency.
- Glossary / term normalization (`docs/wall-field-backlog.md` #4). That belongs *after* the
  stitch, where whole words exist — a natural next step, not this one.
- Removing the 2-hour capture rotation (backlog #5). The rotation-repair branch is needed
  for the existing archive regardless.
- Re-running speech recognition, correcting mishearings, or summarizing. The stitch is
  lossless reassembly plus annotation.
- Touching the dictation `/dd` path's output. There the raw text is the user's message.

## Decisions

### Per-channel rebuild, then merge finished sentences

Rebuild each channel's full text independently (`rebuildChannel`), split *that* into
sentences (`splitSentences`), then merge both channels' sentences chronologically. The key
insight from the reference implementation: a channel's fragments are complete and in order
*within* the channel — only the interleaving destroyed readability.

*Alternative rejected:* stitching in the interleaved stream order, joining any line to the
previous line of the same speaker. It produces the same text but needs the whole
lookback bookkeeping at every step, and it makes the sentence-splitting boundary-dependent —
a sentence that spans an interjection cannot be split until both halves are known anyway.

### Word boundaries: exact first, heuristic only as fallback

`separator()` returns `""` for `midWord`, `" "` for `cont` without it, and only reaches the
dictionary heuristic when neither field is present. Every heuristic decision is counted, so
`--stats` reports it. On a post-`a30d12f` input the guessed count is 0 — that is an
acceptance criterion, not just a nicety.

The heuristic biases toward inserting a space: an unnecessary space is a cosmetic error, a
wrongly glued pair of words destroys two words. It joins without a separator only when the
previous fragment ends in a letter, the next starts with a lowercase letter, the gap is
under the pause threshold, and neither adjoining word is in the complete-word list.

### False sentence terminators are rejoined too (found by measuring, not by design)

The first working implementation was measured against a real post-fix recording and barely moved
the needle: 745 lines → 642 sentences, and the share of sentences starting mid-thought stayed at
29%. The cause was not the flush at all — the recognizer drops periods mid-utterance ("…hm,
dehogy. ma már volt egy sessionünk"), and splitting on those rebuilds exactly the fragments the
stitch exists to remove.

So a terminator whose next non-whitespace character is a **lowercase letter** is not treated as a
sentence boundary. Re-measured: 745 → 451 sentences, fragment-start **29% → 0%**, median sentence
length 24 → 39 characters, longest 487 (no runaway merging). The terminator stays in the text, so
this changes where a sentence is cut and never what it says.

The test is `\p{Ll}` and not "not uppercase" on purpose: Chinese, Japanese and Thai have no case
(`\p{Lo}`), and a "not uppercase" rule would merge an entire transcript in those languages into a
single sentence.

*Alternative rejected:* a capitalization-repair pass. It would edit the speaker's words on a
guess; this only moves a cut.

### The complete-word list is `transcript.completeWords`, with defaults

The reference implementation's `COMPLETE_WORDS` is a Hungarian function-word list. Shipping
that inside `src/` is precisely the "project leaking back into the engine" failure mode.
It becomes a config key with defaults covering Hungarian and English — the same shape
`detect.urgency` / `detect.question` already use.

*Alternative rejected:* deriving the list from the knowledge index. The index holds domain
nouns; the heuristic needs high-frequency function words, which is the opposite population.

### Two output artifacts, both always

`.md` for humans and LLMs (timestamped, speaker-labelled turns, rotation and reconnect
markers), sentence-level `.jsonl` for tools (`speaker`, `text`, `startTs`, `endTs`,
`overlap`, and whether the sentence's joins were exact). Emitting both unconditionally —
rather than behind a flag — means a machine consumer never has to parse Markdown and never
has to know a flag existed when the file was produced. The cost is one extra small file per
meeting.

*Alternative rejected:* Markdown only, with the library export as the machine path. It makes
every tool depend on Node and on our API version, and it means a transcript archived a month
ago can only be consumed by re-running the stitch.

### Stop-time generation runs on the archived path, after the rename

`handoverAtStop` calls the stitch with the path `handoverTranscriptOnce` returned. Running
before the rename would produce artifacts named after the live file, and would put work
between the capture's exit and the "exactly once" rename. The rename stays the single source
of truth for the handover invariant; the stitch is strictly downstream of it and cannot
affect it — a stitch error is reported and the archived path is still returned.

The `--print` (dictation) branch returns before the stitch, untouched.

### `startTs` decides ordering, `ts` is the fallback

Sorting on `ts` returns *completion* order, which with two channels is not speaking order —
a long utterance completes after several short ones from the other side. The stitch sorts on
`startTs`, falling back to `ts` for pre-`a30d12f` files. This is why the reference
implementation records `{pos, ts, endTs}` marks per fragment and reads the sentence's start
timestamp at its first non-whitespace character: the space after a sentence-ending
punctuation still belongs to the *previous* fragment, and reading the timestamp there would
give the sentence the previous utterance's time.

### Rotation repair stays, even though rotation may go away

`applyRotationOffset` detects a backwards jump larger than a minute and offsets everything
after it. Even if the 2-hour limit is removed (backlog #5), every already-archived rotated
transcript still needs this branch.

### Input resolution mirrors the handover

No `--input` resolves the runtime dir's last transcript via the same `lastTranscript()`
logic the handover uses — so the command operates on the same file the stop path would,
with no second notion of "the current transcript". A directory or glob input processes each
match independently; one bad file logs and is skipped rather than aborting a 179-file
backfill.

### Structure: `src/transcript-build.ts`, pure, exported

One module holding the pure functions (`applyRotationOffset`, `separator`, `rebuildChannel`,
`splitSentences`, `markOverlaps`, `renderMarkdown`, `renderJsonl`) plus a `stitchTranscript()`
entry point taking parsed lines and options and returning artifacts as strings. File I/O and
argument parsing live in `cli.ts`. That split is what keeps the module testable the way
`transcript-writer.test.ts` is testable, and it is what makes the library export meaningful.

## Risks / Trade-offs

- **The heuristic glues two words that were genuinely separate** → It only fires on legacy
  inputs, it is biased toward inserting a space, and `--stats` reports how many boundaries it
  had to guess so a reader can weigh the transcript. The exact path is unaffected.
- **The stitch becomes a second, divergent source of truth** → The raw `.jsonl` remains the
  archive of record and keeps its exact shape; the stitch is derived and reproducible from it
  at any time. Nothing is deleted.
- **Stop gets slower** → The stitch is a single pass over a file that is at most a few MB, with
  no I/O beyond reading it and writing two files. It runs after the process kill and the rename,
  so it cannot delay the capture's flush.
- **A stitch bug takes down `stop`** → The derived step is wrapped: a failure is reported and
  the archived path is still returned. The handover invariant does not depend on it.
- **A redaction window silently drops content** → Each cut window renders an explicit marker
  naming the window and its reason, so a reader sees that something was removed. This is a
  *time-window* cut supplied per run — deliberately not the wall's pattern-based
  `wall.redaction`, which solves a different problem (an open payload published live).
- **Regression fixtures could leak client data** → The fixture is synthetic, hand-written to
  reproduce the failure shape (`…a speci` + `fikációig…` mid-word boundary with cross-channel
  interleaving). Real recordings stay in the `consumer-f` / `set-promo` repos.

## Migration Plan

No data migration. The change is additive: existing raw transcripts are unchanged and every
current consumer keeps working.

- **Rollout**: ship the command first; `transcript.stitchOnStop` defaults on, so the next
  meeting produces the artifacts with no user action.
- **Backfill**: run `set-copilot transcript --input <dir> --stats` per project over the 258
  archived files. The stitch is idempotent and writes new files beside the inputs, so a rerun
  after a heuristic improvement is safe.
- **Rollback**: set `transcript.stitchOnStop: false` — the handover returns to exactly its
  current behavior. The command remains available.

## Open Questions

- Should the stop-time artifacts be regenerated when the stitch improves (e.g. after glossary
  normalization lands), or is a one-off backfill enough? Leaning one-off: the raw file is
  retained, so regeneration is always possible on demand.
- Does the `meeting-copilot` skill's post-meeting note-taking step need a stronger nudge than
  a path in the summary — e.g. refusing to read the raw `.jsonl` when a `.md` exists? Deferred
  until the `.md` has been used in anger for a few meetings.
