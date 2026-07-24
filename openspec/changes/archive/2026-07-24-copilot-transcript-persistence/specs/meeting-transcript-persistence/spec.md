## ADDED Requirements

### Requirement: A meeting transcript is handed over exactly once at stop

When a meeting-mode capture stops, the system SHALL hand the transcript over exactly once: it SHALL
archive the live transcript to a timestamped file and leave no live transcript that a later capture or a
repeated stop could replay as if freshly spoken. This mirrors the dictation handover invariant already
enforced for `/dd`.

#### Scenario: Meeting stop archives once

- **WHEN** a meeting-mode capture is stopped
- **THEN** the live transcript is renamed to a timestamped archive (`transcript-<timestamp>.jsonl`) and its
  path is reported, and no live transcript remains at the configured path

#### Scenario: A repeated stop does not re-hand-over

- **WHEN** `stop` runs again after the transcript was already handed over
- **THEN** nothing is re-archived and nothing is re-emitted — the second stop reports that there is nothing
  to hand over

### Requirement: Handover persists a durable, discoverable artifact without reprinting contents

The meeting handover SHALL produce a durable, timestamped transcript file in the capture's runtime dir and
SHALL report that file's path, WITHOUT printing the transcript contents back to the caller. Emitting the
contents SHALL remain a separate, explicit opt-in used by dictation, so the meeting flow never replays a
whole transcript into the session as if it were freshly spoken.

#### Scenario: Path reported, contents withheld (meeting)

- **WHEN** a meeting-mode capture stops with archival
- **THEN** the saved archive path is printed and the transcript body is NOT printed

#### Scenario: Dictation still prints and archives once

- **WHEN** a dictation stop requests the contents (the `/dd` path)
- **THEN** the contents are emitted and the transcript is archived exactly once, unchanged from today's
  behavior

### Requirement: Archival never truncates and respects runtime-dir ownership

Handover SHALL archive by renaming rather than truncating, and SHALL act only on the transcript owned by the
stopping capture's runtime dir. A stop invoked with no live capture but an unconsumed transcript still
present SHALL hand that transcript over once (covering a capture that self-stopped on `--max-minutes`).

#### Scenario: Timer-expired capture is still handed over

- **WHEN** a capture already self-stopped on its `--max-minutes` limit and a later `stop` runs in the same
  runtime dir
- **THEN** the leftover transcript is archived exactly once and its path reported

#### Scenario: The prior transcript stays readable

- **WHEN** handover runs
- **THEN** the previous transcript remains readable under its archived, timestamped name (never truncated)

### Requirement: The meeting-copilot stop flow surfaces the saved transcript

The `meeting-copilot` skill's stop flow SHALL trigger the archival handover and SHALL report the saved
transcript path in its closing summary, so the operator (or a follow-up processing step) can find the full
meeting transcript after the session.

#### Scenario: Stop summary names the saved file

- **WHEN** `/meeting-copilot stop` runs
- **THEN** the closing summary includes the archived transcript's path alongside the meeting summary
