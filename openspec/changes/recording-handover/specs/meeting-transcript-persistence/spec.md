# Spec Delta

## IN SCOPE

- Meeting and dictation stops hand over through one function with one environment, plus
  `SET_COPILOT_KIND` and `SET_COPILOT_RECORDED_AT`.
- A dictation stop produces the readable and structured artifacts beside its archive, reported on
  stderr.
- A kind with no configured command persists to the built-in target `docs/inputs/copilot/`,
  de-duplicated by SHA-256, never committed.
- A successful command hand-off is recorded in a machine-local ledger.

## OUT OF SCOPE

- Routing dictations into `copilot.handoverCommand` (design D1).
- Committing, pushing or `git add`-ing anything.
- Changing what a dictation stop prints on stdout.
- A config key to disable the built-in target or to move it.

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
answer. After the text is emitted and the transcript archived, a dictation stop SHALL also produce the
readable Markdown and the structured JSONL beside the archive, from the archived file and under the same
`transcript.stitchOnStop` setting, reporting their paths on stderr only: the emitted message is unchanged,
and the readable file exists so that the dictation, once persisted, can be found by a text search like any
other recording.

#### Scenario: Path reported, contents withheld (meeting)

- **WHEN** a meeting-mode capture stops with archival
- **THEN** the saved archive path is printed and the transcript body is NOT printed

#### Scenario: Dictation still prints and archives once

- **WHEN** a dictation stop requests the contents (the `/dd` path)
- **THEN** the contents are emitted and the transcript is archived exactly once, and stdout carries
  nothing but the dictated text

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

#### Scenario: A dictation stop writes the readable artifacts off the message channel

- **WHEN** a dictation stop archives a non-empty transcript with `transcript.stitchOnStop` enabled
- **THEN** the `.md` and `-stitched.jsonl` are written beside the archive, their paths appear on
  stderr, and stdout is exactly the dictated text

### Requirement: A project command may run after the handover

The handover SHALL support a configured project command (`copilot.handoverCommand`) that runs
**after** the transcript is archived and the derived artifacts are written, receiving the archived
paths, so a project-specific hand-off (moving the transcript out of the gitignored runtime dir into
the project's own inputs) needs no fork of the shared skill. The command SHALL receive, through the
environment, `SET_COPILOT_TRANSCRIPT` (the archive), `SET_COPILOT_TRANSCRIPT_MD` and
`SET_COPILOT_TRANSCRIPT_JSONL` (when produced), `SET_COPILOT_DIR`, `SET_COPILOT_KIND=meeting`, and
`SET_COPILOT_RECORDED_AT` (the recording's ISO timestamp), plus `COPILOT_HANDOVER_SLUG` when the
caller's environment carries it. Absent configuration SHALL leave the archive and the derived
artifacts exactly as they are today and SHALL persist the recording to the built-in target instead
of running a command.

The command SHALL NOT be able to fail the handover: a non-zero exit, a missing executable, or a
timeout SHALL be reported and the archived path still returned, on the same reasoning the derived
artifacts already follow — the archive is the invariant, everything after it is a convenience. It is
what makes the shared skill sufficient for a project that would otherwise keep its own copy; without
it, measured 2026-07-30, six transcripts stayed unhanded under `.set/copilot/`, the largest 18 500
words, with no input record anywhere pointing at them. A command that exits 0 SHALL be recorded as a
successful hand-off of that recording's content in the machine-local hand-off ledger
(`recording-backfill`); a failed one SHALL NOT be.

#### Scenario: The configured command runs after archival

- **WHEN** a meeting-mode capture stops with `copilot.handoverCommand` configured
- **THEN** the transcript is archived, the derived artifacts are written, and only then is the
  command run, with the archived paths and `SET_COPILOT_KIND=meeting` available to it

#### Scenario: A failing command does not lose the handover

- **WHEN** the configured command exits non-zero, cannot be executed, or exceeds its time limit
- **THEN** the failure is reported and the archived transcript path is still returned, with the
  archive left intact, and no successful hand-off is recorded

#### Scenario: No command configured leaves the handover unchanged

- **WHEN** a meeting-mode capture stops with no `copilot.handoverCommand` configured
- **THEN** the archive and the derived artifacts are produced exactly as before, no project command
  is run, and the recording is persisted to the built-in target

### Requirement: A project command may run after a dictation handover

The dictation stop path (`stop --print`) SHALL support its own configured project command,
`copilot.dictationHandoverCommand`, run **after** the dictated text was emitted, the transcript
archived and the derived artifacts written, and only when something was archived. It SHALL receive
the same environment as the meeting command — `SET_COPILOT_TRANSCRIPT`, `SET_COPILOT_TRANSCRIPT_MD`
and `SET_COPILOT_TRANSCRIPT_JSONL` when produced, `SET_COPILOT_DIR`, `SET_COPILOT_RECORDED_AT` — with
`SET_COPILOT_KIND=dictation`. It SHALL be a separate key from `copilot.handoverCommand`: the meeting
command SHALL NOT run on a dictation stop, and the dictation command SHALL NOT run on a meeting stop.
An absent or empty value SHALL run no command and SHALL persist the dictation to the built-in target;
a value that is not a string SHALL be ignored with a warning naming the key.

The command SHALL NOT be able to fail the handover: a non-zero exit, a missing executable, or
exceeding its 60-second limit SHALL be reported with the archived path, and the archive SHALL stay
intact — the same posture `copilot.handoverCommand` takes, because the rename is the invariant and
everything after it is a convenience. A command that exits 0 SHALL be recorded in the machine-local
hand-off ledger, as for a meeting.

Dictation transcripts land in the gitignored runtime directory, and lifting them into a project's
inputs was left to a later manual step. Measured in a consumer project: the lift script existed and
nothing called it, every saved dictation came from a hand-run, and the ones nobody ran it for were
simply gone — silently, because an inputs tree with no dictations in it looks exactly like a project
where nobody dictated.

#### Scenario: The command runs after print and archive

- **WHEN** a dictation stop runs with `copilot.dictationHandoverCommand` configured and a non-empty
  transcript
- **THEN** the dictated text is emitted, the transcript is archived, and only then is the command run
  with `SET_COPILOT_TRANSCRIPT` naming the archived file and `SET_COPILOT_KIND=dictation`

#### Scenario: Nothing archived, nothing run

- **WHEN** a dictation stop finds no transcript, or an empty one
- **THEN** the command is not run and nothing is persisted

#### Scenario: The keys do not cross paths

- **WHEN** only `copilot.handoverCommand` is configured and a dictation stop runs
- **THEN** no project command runs on that stop, and the dictation is persisted to the built-in
  target

#### Scenario: A failing command does not lose the dictation

- **WHEN** the configured command exits with status 3
- **THEN** a report naming `copilot.dictationHandoverCommand`, the failure, and the intact archived
  path is emitted, and the transcript remains archived

## ADDED Requirements

### Requirement: A recording with no configured command persists to the built-in target

When a stop hands over a recording of a kind whose command key (`copilot.handoverCommand` for a
meeting, `copilot.dictationHandoverCommand` for a dictation) is not configured, the system SHALL copy
the recording into `docs/inputs/copilot/` of the git work tree that contains the project root,
creating the directory if needed: the raw archive byte for byte as `<YYYY-MM-DD>-<kind>-part<N>.jsonl`,
and, when they were produced, the readable transcript as `<…>-part<N>.md` and the structured
transcript as `<…>-part<N>-stitched.jsonl`, where `<kind>` is `dictation` or `meeting`, the date is the
recording's local date, and `N` is the lowest number for which none of the three names exists in the
work tree, in `HEAD`, or in the current branch's upstream tree.

The copy SHALL be skipped when a file byte-identical to the raw archive (equal SHA-256) is already
present in the work tree among tracked or untracked-but-not-ignored files; identity SHALL NOT be
decided by file name. Outside a git work tree the copy SHALL be skipped with a note naming the
archive. The system SHALL NOT stage or commit anything; it SHALL report the paths it wrote and the
`git add` command for them — on stdout for a meeting, on stderr for a dictation. A failure of the copy
SHALL be reported and SHALL NOT fail the stop. A configured command for that kind SHALL replace the
built-in target entirely.

#### Scenario: A dictation in a project with no dictation command is saved with its readable file

- **WHEN** a dictation stop runs in a git work tree with no `copilot.dictationHandoverCommand` and a
  non-empty transcript, on 2026-10-07 with no earlier copies that day
- **THEN** `docs/inputs/copilot/2026-10-07-dictation-part1.jsonl` is byte-identical to the archive,
  `…-part1.md` and `…-part1-stitched.jsonl` exist beside it, nothing is staged, and the paths are
  reported on stderr while stdout carries only the dictated text

#### Scenario: A content-identical copy is not saved twice

- **WHEN** the built-in target runs for a recording whose raw bytes already exist anywhere in the work
  tree under any name
- **THEN** nothing is written and the existing copy's path is reported

#### Scenario: Part numbers do not collide

- **WHEN** `2026-10-07-meeting-part1.jsonl` already exists and a different 2026-10-07 meeting is
  handed over
- **THEN** it is written as `2026-10-07-meeting-part2.*`

#### Scenario: A configured command replaces the default

- **WHEN** a meeting stops with `copilot.handoverCommand` configured
- **THEN** nothing is written to `docs/inputs/copilot/` by the engine

#### Scenario: Outside a git work tree nothing is created

- **WHEN** a stop with no configured command runs from a directory that is not inside a git work tree
- **THEN** no directory is created, and a note names the archived recording
