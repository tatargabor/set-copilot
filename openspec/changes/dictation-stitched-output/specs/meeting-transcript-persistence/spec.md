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

The dictation opt-in SHALL emit the dictated text **reassembled into sentences**, not the raw transcript
body. The raw text is the user's message, and handing a consumer fragments obliges it to guess a word
boundary it has no information to resolve — the very question the capture records `cont` / `midWord` to
answer. Dictation SHALL still receive no derived artifacts on disk: the text is a message, not a document.

#### Scenario: Path reported, contents withheld (meeting)

- **WHEN** a meeting-mode capture stops with archival
- **THEN** the saved archive path is printed and the transcript body is NOT printed

#### Scenario: Dictation still prints and archives once

- **WHEN** a dictation stop requests the contents (the `/dd` path)
- **THEN** the contents are emitted and the transcript is archived exactly once — and no derived
  artifacts are produced, because there the text is the user's message, not a document

#### Scenario: Dictation emits reassembled text, not raw lines

- **WHEN** a dictation stop requests the contents and the transcript was fragmented by the
  capture's flush rules
- **THEN** the emitted text is the reassembled dictation, with word boundaries resolved from what
  the capture recorded, and carries no transcript syntax for the consumer to parse

#### Scenario: Stop reports the readable and structured artifacts

- **WHEN** a meeting-mode capture stops with archival and a non-empty transcript
- **THEN** the readable `.md` and the sentence-level `.jsonl` are written next to the archive, and all
  three paths are printed

#### Scenario: A stitch failure does not lose the archive

- **WHEN** the derived-artifact step fails on an archived transcript
- **THEN** the failure is reported and the archived transcript path is still returned, with the archive
  left intact
