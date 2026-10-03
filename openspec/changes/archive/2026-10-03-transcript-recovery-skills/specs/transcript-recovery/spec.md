## ADDED Requirements

### Requirement: Recovery discovers transcripts beyond the naming convention

The recovery workflow SHALL find a project's transcripts in the places they actually live —
the per-session runtime dirs, and any directory where recordings were filed by hand — and SHALL
NOT rely on the capture's naming convention alone. When a candidate directory holds `.jsonl`
files that do not match the convention, the workflow SHALL consider them rather than silently
skipping them.

#### Scenario: A hand-named recording is found

- **WHEN** a directory holds `2026-07-14-<name>-raw-part1.jsonl`, which the directory scan's
  convention skips
- **THEN** the workflow still offers it for recovery, using an explicit pattern

#### Scenario: Non-transcript JSONL is not mistaken for a recording

- **WHEN** a runtime dir also holds `wall-events.jsonl`
- **THEN** it is not treated as a transcript

### Requirement: Every recovered transcript is graded for reliability

The workflow SHALL state, for each recovered transcript, how much of its reconstruction was
exact and how much was inferred, and SHALL turn that into an explicit grade rather than leaving
raw counts for the reader to interpret. A transcript whose word boundaries were mostly guessed
SHALL NOT be presented with the same confidence as one reconstructed exactly.

#### Scenario: An exactly reconstructed transcript is graded reliable

- **WHEN** a transcript's word boundaries were all taken from the capture's own markers
- **THEN** it is graded as reliable, and the grade states that nothing was guessed

#### Scenario: A heavily inferred transcript is graded suspect

- **WHEN** a large share of a transcript's word boundaries were inferred, and some were joined
  without a separator
- **THEN** it is graded as suspect, with the counts stated, and the reader is told the text may
  contain wrongly joined words

### Requirement: Recovery names the limits that make a transcript unusable

The workflow SHALL detect and state the two conditions under which a stitched transcript cannot
be read as a faithful record, rather than presenting the output as if it were one:

1. **More than one speaker on a channel.** The reconstruction joins a channel's fragments in
   order; when two remote speakers overlap on the same channel their utterances interleave, and
   the speaker identity is not present in the recording to separate them.
2. **A recording split across files.** Each file's timeline restarts, so two files are two
   separate timelines and their timestamps SHALL NOT be read as one.

#### Scenario: Interleaved speakers are called out

- **WHEN** a channel's reconstruction shows fragments of two overlapping speakers joined into
  single sentences
- **THEN** the report states that this channel carried more than one speaker, that the stitch
  cannot separate them, and that the affected text is not a faithful record of either speaker

#### Scenario: A split recording is not presented as one timeline

- **WHEN** a meeting was recorded across more than one file
- **THEN** each file is reported as its own timeline, and their timestamps are not compared or
  merged

### Requirement: Recovery reads the transcript for what never reached the notes

The point of recovery is the knowledge, not the file. The workflow SHALL read each recovered
transcript against the project's existing notes and knowledge base and SHALL report what was
said that never reached them — the step that would have caught the loss this work exists to
prevent. Findings SHALL cite where in the transcript they came from, so a claim can be checked
against the recording.

#### Scenario: A fact present in the recording but absent from the notes is surfaced

- **WHEN** a recovered transcript contains a statement of fact that appears nowhere in the
  project's notes or knowledge base
- **THEN** it is reported as a finding, quoted, with its timestamp

#### Scenario: A finding from a suspect transcript is marked as such

- **WHEN** a finding comes from a transcript graded suspect or from an interleaved channel
- **THEN** the finding carries that caveat, so it is verified against the recording before being
  recorded as fact

#### Scenario: Nothing missing is a valid result

- **WHEN** everything in a transcript is already reflected in the notes
- **THEN** the workflow reports that, and the review still counts as done

### Requirement: The expensive review runs once per transcript

The reading pass SHALL be performed at most once per transcript. The workflow SHALL consult the
recovery record before reading, SHALL skip a transcript already reviewed, and SHALL record the
review through the engine once it completes. Re-reading SHALL require an explicit override.

#### Scenario: An already-reviewed transcript is not read again

- **WHEN** recovery runs over a project where some transcripts were reviewed previously
- **THEN** only the unreviewed ones are read, and the rest are listed as already done

#### Scenario: The review is recorded when it finishes

- **WHEN** a review pass completes
- **THEN** the review step is recorded for that transcript, so the next run skips it

#### Scenario: An interrupted review is not recorded

- **WHEN** a review is interrupted before it finishes
- **THEN** no review record is written and the transcript stays pending

### Requirement: The workflow claims a review before reading and delivers findings through the record

The workflow SHALL claim a transcript's review before reading it, and SHALL deliver its findings
through the completion command rather than reporting them and recording separately — so that
producing the result and recording it are one act. It SHALL NOT present findings by any path that
leaves the review unrecorded.

#### Scenario: The claim precedes the read

- **WHEN** the workflow begins reviewing a transcript
- **THEN** the review is claimed first, so an interruption leaves a visible dangling claim

#### Scenario: Findings are submitted, not just displayed

- **WHEN** a review produces findings
- **THEN** they are submitted through the completion command, and the report shown to the operator
  is derived from what was submitted

#### Scenario: A review the workflow decides not to finish is abandoned explicitly

- **WHEN** the workflow cannot complete a claimed review (the transcript is unusable, or the
  operator stops it)
- **THEN** the claim is abandoned explicitly, and the transcript returns to pending

### Requirement: The workflow states whether completion is enforced

The workflow SHALL check whether the mechanism that gates an unfinished review is installed, and
SHALL say so when it is not — because in that case a forgotten completion is possible again, and
the operator needs to know that before relying on the run's bookkeeping.

#### Scenario: Missing enforcement is reported

- **WHEN** the gating mechanism is not installed in this project
- **THEN** the workflow reports that completion is not enforced and names how to install it

#### Scenario: Present enforcement is not narrated

- **WHEN** the mechanism is installed
- **THEN** the workflow proceeds without commentary about it
