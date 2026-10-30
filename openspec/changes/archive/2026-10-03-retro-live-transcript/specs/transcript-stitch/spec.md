# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
