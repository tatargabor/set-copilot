# transcript-stitch Specification

## Purpose
Reconstruct the capture's fragmented transcript lines — cut by flush boundaries, interleaved
across two independent channels, and occasionally split mid-word — into a readable, correctly
ordered transcript. The stitch is the consumer side of the `startTs` / `partial` / `cont` /
`midWord` fields the writer records: it rebuilds each channel on its own, splits that into
sentences, merges them on speaking order, and emits both a Markdown transcript for human and LLM
readers and a sentence-level JSONL for machine consumers.

## Requirements
### Requirement: Fragmented transcript lines are reconstructed into whole sentences

The system SHALL reconstruct the capture's fragmented transcript lines into whole
sentences. Because a channel's fragments are complete *within* that channel, the system
SHALL rebuild each channel's text independently first, split that text into sentences,
and only then merge the finished sentences from both channels into one stream. The system
SHALL NOT attempt to reassemble across channels, which would interleave halves of two
different utterances.

#### Scenario: Six interleaved fragments become one sentence

- **WHEN** a transcript contains six consecutive `system` fragments of one utterance, with
  `mic` lines interleaved between them
- **THEN** the output contains that utterance as a single sentence attributed to `system`,
  with the interleaved `mic` speech kept as separate sentences

#### Scenario: A fragment that never reaches a sentence end still appears

- **WHEN** a channel's last fragment ends without sentence-ending punctuation (the capture
  stopped mid-utterance)
- **THEN** the trailing text is emitted as a sentence rather than discarded

### Requirement: A sentence terminator followed by a lowercase word is not a sentence boundary

The flush boundaries are not the only source of fragmentation: the recognizer also emits a
sentence terminator mid-utterance. The system SHALL NOT split at a terminator whose next
non-whitespace character is a lowercase letter, and SHALL keep the terminator in the text — this
changes where a sentence is cut, never what it says. The test SHALL be for a lowercase letter
specifically, not for "not uppercase", so that case-less scripts are unaffected.

#### Scenario: A mid-utterance period does not fragment the sentence

- **WHEN** the rebuilt text reads `hm, dehogy. ma már volt egy sessionünk.`
- **THEN** it is emitted as ONE sentence, with the stray terminator still present in the text

#### Scenario: A real sentence start still splits

- **WHEN** a terminator is followed by an uppercase letter, a digit, or a quotation mark
- **THEN** the text is split there

#### Scenario: A case-less script is not merged into one blob

- **WHEN** the text is in a script with no letter case (such as Chinese or Japanese)
- **THEN** its terminators still split, because no character is a lowercase letter

### Requirement: Word boundaries are exact when the capture recorded them

At a join between two consecutive fragments of the same channel, the system SHALL use the
resuming line's `cont` and `midWord` fields as the authority when present: `midWord` SHALL
join with no separator, `cont` without `midWord` SHALL join with a single space. The system
SHALL NOT apply a heuristic to a join that carries these fields.

#### Scenario: A mid-word cut is rejoined seamlessly

- **WHEN** a line ending `…az árajánlattól a speci` is followed by a `cont` + `midWord`
  line starting `fikációig, izé, minden.`
- **THEN** the joined text reads `…az árajánlattól a specifikációig, izé, minden.` with no
  separator inserted at the boundary

#### Scenario: A word-boundary cut is rejoined with a space

- **WHEN** a line ending `…nekünk Google Drive-on` is followed by a `cont` line without
  `midWord`
- **THEN** the two parts are joined with exactly one space

### Requirement: Legacy recordings fall back to a bounded word-boundary heuristic

For joins with no `cont`/`midWord` fields — recordings made before the capture recorded
them — the system SHALL decide the separator heuristically, and SHALL bias toward a space
(the non-destructive choice). The system SHALL treat a join as a word boundary when the
preceding fragment does not end in a letter, when the following fragment does not begin
with a lowercase letter, when the gap between the fragments exceeds a silence threshold, or
when either adjoining word appears in the configured complete-word list. Only when none of
these hold SHALL it join without a separator.

#### Scenario: A complete function word forces a space

- **WHEN** a legacy join has `…van` on one side and `összehalmozva` on the other, and `van`
  is in the complete-word list
- **THEN** the parts are joined with a space, not concatenated

#### Scenario: A long pause forces a space

- **WHEN** a legacy join spans a gap larger than the configured pause threshold
- **THEN** the parts are joined with a space regardless of the surrounding characters

#### Scenario: A capitalised continuation is not glued

- **WHEN** the following fragment begins with an uppercase letter or a digit
- **THEN** the parts are joined with a space, because a new word has clearly started

### Requirement: The complete-word list is configuration, not code

The word list behind the heuristic fallback SHALL be resolved from configuration
(`transcript.completeWords`) with built-in defaults, so a project working in another
language can supply its own without modifying the engine. Word matching SHALL use Unicode
letter and number classes, never `\b` or an enumerated Latin character class.

#### Scenario: A project overrides the word list

- **WHEN** a project config sets `transcript.completeWords`
- **THEN** the heuristic uses that list in place of the defaults, and no engine source file
  needs to change

#### Scenario: Accented words are matched as whole words

- **WHEN** the heuristic compares an accented word such as `illetve` against the list
- **THEN** the accented characters are treated as letters, not as word boundaries

### Requirement: Sentences are ordered by when they were spoken

The merged output SHALL be ordered by each sentence's **start** timestamp, derived from the
contributing lines' `startTs`. When `startTs` is absent — recordings that predate the field
— the system SHALL fall back to `ts`. Ordering by completion time alone SHALL NOT be used,
because with two channels a long utterance completes after several short ones from the other
side, so completion order is not speaking order.

#### Scenario: A long utterance keeps its place in the conversation

- **WHEN** a long `system` utterance starts before, and finishes after, several short `mic`
  lines
- **THEN** the `system` sentence appears before those `mic` sentences in the output

#### Scenario: A recording without `startTs` still produces output

- **WHEN** the input lines carry only `ts`
- **THEN** the stitch completes using `ts` as the start timestamp, without error

### Requirement: A capture rotation is repaired onto a real timeline

When a capture restarted at its duration limit and its timestamps resume from zero, the
system SHALL detect the backward jump, offset the later segment onto the real timeline, and
mark the break in the output. The later segment SHALL NOT appear to return to the beginning
of the meeting.

#### Scenario: The second segment does not jump backwards

- **WHEN** the input's timestamps drop sharply back toward zero partway through
- **THEN** every sentence after that point carries a timestamp later than the ones before
  it, and the output contains an explicit rotation marker at the break

### Requirement: Overlapping speech and connection losses are marked

The system SHALL mark a sentence whose time span overlaps a sentence from the other channel,
and SHALL render a `reconnect` event as a visible warning at its position in the transcript,
naming the gap. Non-speech events that carry no text (such as `silence`) SHALL be skipped.
A reader SHALL NOT be able to mistake a transcript with a transcription hole for a complete
one.

#### Scenario: A connection loss is visible in the output

- **WHEN** the input contains a `reconnect` event between two sentences
- **THEN** the output carries a warning line at that position stating that words may be
  missing, rather than joining the surrounding sentences seamlessly

#### Scenario: Silence events do not become text

- **WHEN** the input contains `{"type":"silence"}` lines
- **THEN** they produce no transcript text

#### Scenario: Overlapping speech is marked

- **WHEN** a `mic` sentence's span overlaps a `system` sentence's span
- **THEN** both are marked as overlapping in the output

### Requirement: The stitch emits a readable and a structured artifact

Each stitch SHALL produce both a Markdown transcript for human and LLM readers — timestamped,
speaker-labelled turns — and a sentence-level JSONL for machine consumers, so a tool never has
to parse Markdown. Each structured line SHALL carry at least the sentence text, its speaker,
its start and end timestamps, and whether it overlapped the other channel.

#### Scenario: Both artifacts are written

- **WHEN** a stitch runs over a non-empty transcript
- **THEN** a `.md` and a sentence-level `.jsonl` are written, containing the same sentences
  in the same order

#### Scenario: Speaker labels come from configuration

- **WHEN** `transcript.speakers` maps `mic` and `system` to display names
- **THEN** the Markdown uses those names, and an unmapped channel falls back to its raw
  channel name

### Requirement: The stitch reports how much of its output was guessed

The system SHALL report, on request, how many segments and sentences it produced and how many
word boundaries were decided **exactly** (from `cont`/`midWord`) versus **guessed** (by the
heuristic), so a reader can judge a legacy recording's reliability. The statistics SHALL go to
a stream separate from the transcript output.

#### Scenario: A post-fix recording reports zero guesses

- **WHEN** statistics are requested for an input whose joins all carry `cont`/`midWord`
- **THEN** the guessed-boundary count is zero

#### Scenario: A legacy recording reports its guesses

- **WHEN** statistics are requested for an input with no `cont`/`midWord` fields
- **THEN** the guessed-boundary count is greater than zero and is reported alongside the
  segment and sentence counts

### Requirement: The stitch is available as a command over a file, a directory, or the last transcript

The system SHALL expose the stitch as a `set-copilot transcript` command accepting an input
file, directory, or glob, an output path, a speaker map, an optional redaction window list,
and a statistics flag. With no input given, it SHALL operate on the runtime dir's last
transcript, resolved the same way the stop-time handover resolves it. With no output given,
it SHALL write alongside the input. A directory or glob input SHALL process every matching
transcript in one run, so an existing archive can be backfilled without a per-project script.

#### Scenario: Backfilling an archive directory

- **WHEN** `set-copilot transcript --input <dir>` runs over a directory of archived
  transcripts
- **THEN** every matching transcript is stitched, each writing its own artifacts, and a
  failure on one input does not abort the remaining ones

#### Scenario: Defaulting to the last transcript

- **WHEN** `set-copilot transcript` runs with no `--input` in a runtime dir with an archived
  transcript
- **THEN** that transcript is stitched

#### Scenario: Redaction windows are cut with a stated reason

- **WHEN** a redaction window list is supplied
- **THEN** sentences inside those time windows are omitted from the output and replaced by a
  single marker naming the window and its reason

### Requirement: An empty or unreadable input is a no-op

The stitch SHALL be a no-op on an empty or absent transcript, writing no zero-byte artifacts,
mirroring the handover's behavior on an empty transcript. A malformed JSONL line SHALL be
skipped rather than aborting the run.

#### Scenario: An empty transcript produces nothing

- **WHEN** the stitch runs on an empty or missing transcript file
- **THEN** no `.md` and no `.jsonl` are written, and the command reports that there was
  nothing to stitch

#### Scenario: A truncated last line is skipped

- **WHEN** the input's final line is truncated JSON (a capture killed mid-write)
- **THEN** the remaining lines are stitched and the truncated line is ignored

### Requirement: Single-channel recordings are stitched too

The stitch SHALL run on a mic-only (dictation) transcript, where lines are still fragmented by
the overflow and silence flush rules even though no cross-channel cutting occurs.

#### Scenario: A dictation transcript is reassembled

- **WHEN** the stitch runs on a transcript containing only `mic` lines
- **THEN** its fragments are rejoined into sentences with the same boundary rules, and no
  overlap markers appear
