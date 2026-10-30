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

- **WHEN** a line ending `…a hétfőtől a pénte` is followed by a `cont` + `midWord`
  line starting `kig, izé, minden.`
- **THEN** the joined text reads `…a hétfőtől a péntekig, izé, minden.` with no
  separator inserted at the boundary

#### Scenario: A word-boundary cut is rejoined with a space

- **WHEN** a line ending `…nálunk a heti tervezésen` is followed by a `cont` line without
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

- **WHEN** a legacy join has `…van` on one side and `összeállítva` on the other, and `van`
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
side, so completion order is not speaking order. The one exception is a recording whose clocks
cannot be trusted (see "Clocks that restarted more often than a rotation explains fall back to
recording order"), which SHALL be ordered by recording order instead, because its timestamps
are not a timeline.

#### Scenario: A long utterance keeps its place in the conversation

- **WHEN** a long `system` utterance starts before, and finishes after, several short `mic`
  lines
- **THEN** the `system` sentence appears before those `mic` sentences in the output

#### Scenario: A recording without `startTs` still produces output

- **WHEN** the input lines carry only `ts`
- **THEN** the stitch completes using `ts` as the start timestamp, without error

#### Scenario: Untrustworthy clocks do not reorder the conversation

- **WHEN** the input's channel clocks restarted more often than a capture rotation explains
- **THEN** the sentences appear in the order their lines were recorded in the file

### Requirement: A capture rotation is repaired onto a real timeline

When a channel's timestamps jump backward by more than a minute partway through one file, the
system SHALL treat it as a clock restart and repair it **per channel**: that channel's later
segment SHALL continue from the latest point the whole file had reached so far (file order is
recording order), while the other channel keeps its own clock. A row with no speaker (such as a
`silence` event) SHALL be placed at the latest point reached and SHALL NOT move the timeline. The
first restart SHALL be marked as the break in the output; later ones SHALL be counted. The later
segment SHALL NOT appear to return to the beginning of the meeting.

Two causes produce the same symptom: a capture that restarted at its duration limit resumes
**both** channels from zero, while a transcription socket that reconnected (in recordings made
before the reconnect fix) restarted **one** channel's clock while the other kept counting.
Measured on a two-hour call: 155 backward jumps on the mic channel alone, and the previous
repair — one restart for the whole file and nothing else — squeezed two hours into four minutes
with both channels interleaved out of order. A speakerless row carries whichever channel's raw clock produced it; letting it drive the
timeline stacked every later segment on a stale clock and stretched the same call to seven
hours.

#### Scenario: The second segment does not jump backwards

- **WHEN** the input's timestamps drop sharply back toward zero partway through
- **THEN** every sentence after that point carries a timestamp later than the ones before
  it, and the output contains an explicit rotation marker at the break

#### Scenario: One channel's restart does not drag the other

- **WHEN** only the `mic` channel's timestamps jump back by more than a minute while the
  `system` channel keeps counting
- **THEN** the `mic` segment after the jump is placed after the latest point already reached,
  and the `system` timestamps are left unchanged

#### Scenario: A silence event does not drive the timeline

- **WHEN** a `silence` event carries a timestamp from a stale channel clock far ahead of the
  speech around it
- **THEN** the event is placed at the latest point the speech had reached, and the following
  speech is not offset by it

### Requirement: Overlapping speech and connection losses are marked

The system SHALL mark a sentence whose time span overlaps a sentence from the other channel,
and SHALL render a `reconnect` event as a visible warning at its position in the transcript,
naming the gap. Non-speech events that carry no text (such as `silence`) SHALL be skipped.
A reader SHALL NOT be able to mistake a transcript with a transcription hole for a complete
one. When the recording-order fallback applies, overlap marks SHALL NOT be produced, because
they would be read off the same broken clocks; reconnect warnings SHALL still be rendered.

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

#### Scenario: No overlap marks under the fallback

- **WHEN** the recording-order fallback applies to an input
- **THEN** no sentence in the output is marked as overlapping

### Requirement: The stitch emits a readable and a structured artifact

Each stitch SHALL produce both a Markdown transcript for human and LLM readers — timestamped,
speaker-labelled turns — and a sentence-level JSONL for machine consumers, so a tool never has
to parse Markdown. Each structured line SHALL carry at least the sentence text, its speaker, its
start and end timestamps, and whether it overlapped the other channel. The `speaker` each
artifact carries SHALL be resolved by the recorded-label rule of "A recorded speaker label
outranks the stitching machine's config", identically in both artifacts.

#### Scenario: Both artifacts are written

- **WHEN** a stitch runs over a non-empty transcript
- **THEN** a `.md` and a sentence-level `.jsonl` are written, containing the same sentences
  in the same order

#### Scenario: Speaker labels come from configuration

- **WHEN** `transcript.speakers` maps `mic` and `system` to display names and the lines carry
  no recorded `speakerName`
- **THEN** the Markdown uses those names, and an unmapped channel falls back to its raw
  channel name

#### Scenario: The two artifacts attribute identically

- **WHEN** a stitch runs over a recording whose mic lines carry a recorded `speakerName`
- **THEN** the Markdown turn labels and the structured lines' `speaker` field carry the same
  recorded label

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

### Requirement: Clocks that restarted more often than a rotation explains fall back to recording order

A whole-capture rotation restarts each channel's clock once. When the total number of clock
restarts in a recording exceeds the number of channels it contains (with a minimum of one), the
system SHALL treat its timestamps as untrustworthy and SHALL:

- order the sentences by recording (file) order;
- assign times read off the steadiest channel — the one whose clock restarted fewest times —
  with that channel's own segments laid end to end, so the times are monotonic and the
  recording keeps approximately its real length;
- omit the capture-rotation marker; and
- open the Markdown transcript with a note stating how many times the clocks restarted, that the
  lines are in recording order, and that the times are approximate.

A single rotation (each channel restarting once) SHALL stay with the ordinary per-channel
repair, keeping speaking order and the rotation marker. Measured on the two-hour call that
motivated this: correct order, and 1:57 of output for a 2:00 recording.

#### Scenario: Many restarts fall back to recording order and say so

- **WHEN** the `mic` channel's clock restarts several times in a two-channel recording while the
  `system` channel runs steadily
- **THEN** the sentences appear in file order, their start times are non-decreasing, the
  Markdown begins with a "Timeline repaired" note, and no capture-rotation marker appears

#### Scenario: The times come from the steadiest channel

- **WHEN** the fallback applies and the steadiest channel's last line is at 900 000 ms
- **THEN** the latest sentence start in the output is 900 000 ms, not a value inflated by the
  other channel's restarts

#### Scenario: A single rotation is not treated as broken clocks

- **WHEN** both channels' clocks restart exactly once at the same point in the file
- **THEN** the ordinary repair applies: speaking order, a capture-rotation marker, and no
  "Timeline repaired" note

### Requirement: A recorded speaker label outranks the stitching machine's config

When a line carries a recorded `speakerName`, the stitch SHALL attribute the sentence to that
recorded label — in the readable transcript, the structured transcript, and every other
rendering of the sentence stream — and SHALL NOT replace it with the name the stitching
machine's `transcript.speakers.*` config resolves, not even when the config has an entry keyed
by the label itself or an explicit `--speakers` override names it: the label was written by the
machine that heard the voice, and every later machine's config answers a different microphone.
A line without a recorded `speakerName` SHALL keep today's behaviour: the stitching machine's
config maps the channel, falling back to the raw channel name. The label SHALL ride beside the
channel, not replace it: grouping, overlap marking and rotation repair SHALL continue to work
on the channel, so a degenerate config that resolves both channels to one label degrades
cosmetically (one name rendered twice) and never merges the channels' rebuild.

#### Scenario: A recorded label wins over the stitching machine's config

- **WHEN** a recording's mic lines carry `"speakerName": "gazda"` and the stitching machine's
  config maps `mic` to `"más"`
- **THEN** the sentence is attributed to `gazda`, in the readable and the structured artifacts

#### Scenario: A recording without the field keeps today's behaviour

- **WHEN** a pre-field recording's mic lines carry only `"speaker": "mic"` and the stitching
  machine's config maps `mic` to `"más"`
- **THEN** the sentence is attributed to `más`, exactly as before

#### Scenario: The recorded label is not fed back through the map

- **WHEN** a line carries `"speakerName": "gazda"` and the config — or an explicit `--speakers`
  override — maps `gazda` to some other string
- **THEN** the sentence is attributed to `gazda` — the recorded label is terminal

#### Scenario: Equal labels do not merge the channels

- **WHEN** a recording's mic and system lines both carry the same recorded `speakerName`, and
  the two channels' speech overlaps
- **THEN** the sentences remain distinct per channel with their overlap marked, and both render
  under the shared label
