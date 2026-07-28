## MODIFIED Requirements

### Requirement: Handover persists a durable, discoverable artifact without reprinting contents

The meeting handover SHALL produce a durable, timestamped transcript file in the capture's runtime dir and
SHALL report that file's path, WITHOUT printing the transcript contents back to the caller. Emitting the
contents SHALL remain a separate, explicit opt-in used by dictation, so the meeting flow never replays a
whole transcript into the session as if it were freshly spoken.

After archival, the handover SHALL additionally produce the readable Markdown transcript and the
sentence-level structured JSONL from the **archived** file, write them beside it, and report all three
paths. Producing them at stop is what makes the readable transcript the artifact that is actually at hand
when a downstream step starts — the loss this change exists to prevent came from a processing step reading
the raw file because that was the one available. Failure to produce the derived artifacts SHALL NOT fail
the handover: the archive is the invariant, the derived files are a convenience, so a stitch error SHALL be
reported and the archived path still returned.

#### Scenario: Path reported, contents withheld (meeting)

- **WHEN** a meeting-mode capture stops with archival
- **THEN** the saved archive path is printed and the transcript body is NOT printed

#### Scenario: Dictation still prints and archives once

- **WHEN** a dictation stop requests the contents (the `/dd` path)
- **THEN** the contents are emitted and the transcript is archived exactly once, unchanged from today's
  behavior — and no derived artifacts are produced, because there the raw text is the user's message,
  not a document

#### Scenario: Stop reports the readable and structured artifacts

- **WHEN** a meeting-mode capture stops with archival and a non-empty transcript
- **THEN** the readable `.md` and the sentence-level `.jsonl` are written next to the archive, and all
  three paths are printed

#### Scenario: A stitch failure does not lose the archive

- **WHEN** the derived-artifact step fails on an archived transcript
- **THEN** the failure is reported and the archived transcript path is still returned, with the archive
  left intact

### Requirement: The meeting-copilot stop flow surfaces the saved transcript

The `meeting-copilot` skill's stop flow SHALL trigger the archival handover and SHALL report the saved
transcript paths in its closing summary, so the operator (or a follow-up processing step) can find the full
meeting transcript after the session. The summary SHALL name the readable transcript as the source intended
for downstream knowledge processing, and the raw JSONL as the archive of record.

#### Scenario: Stop summary names the saved file

- **WHEN** `/meeting-copilot stop` runs
- **THEN** the closing summary includes the archived transcript's path alongside the meeting summary

#### Scenario: Stop summary points knowledge processing at the readable transcript

- **WHEN** `/meeting-copilot stop` runs and the derived artifacts were produced
- **THEN** the closing summary names the readable transcript as the source for note-taking and knowledge
  extraction, and the raw JSONL as the archive

## ADDED Requirements

### Requirement: Stop-time stitching is configurable

Producing the derived artifacts at stop SHALL be controlled by configuration
(`transcript.stitchOnStop`), defaulting to enabled. Disabling it SHALL leave the handover behavior exactly
as it was before this change, and SHALL NOT affect the standalone `set-copilot transcript` command.

#### Scenario: Stitching disabled at stop

- **WHEN** `transcript.stitchOnStop` is set to false and a meeting capture stops
- **THEN** only the archived transcript is produced and its path reported, and no derived artifacts are
  written

#### Scenario: The command works regardless of the stop setting

- **WHEN** `transcript.stitchOnStop` is false and `set-copilot transcript` is run explicitly
- **THEN** the derived artifacts are produced
