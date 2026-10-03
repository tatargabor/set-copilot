# meeting-transcript-persistence Specification

## Purpose
Guarantee that a meeting-mode capture, like dictation, hands its transcript over exactly once at
stop — archiving the live transcript to a durable, timestamped, discoverable artifact and reporting
its path — WITHOUT replaying the contents back into the session. This mirrors dictation's handover
invariant so a post-meeting step can find the full transcript, while never treating the whole
transcript as if freshly spoken.

## Requirements
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

### Requirement: A project command may run after the handover

The handover SHALL support a configured project command (`copilot.handoverCommand`) that runs
**after** the transcript is archived and the derived artifacts are written, receiving the archived
paths, so a project-specific hand-off (moving the transcript out of the gitignored runtime dir into
the project's own inputs) needs no fork of the shared skill. Absent configuration SHALL leave the
handover exactly as it is today.

The command SHALL NOT be able to fail the handover: a non-zero exit, a missing executable, or a
timeout SHALL be reported and the archived path still returned, on the same reasoning the derived
artifacts already follow — the archive is the invariant, everything after it is a convenience. It is
what makes the shared skill sufficient for a project that would otherwise keep its own copy; without
it, measured 2026-07-30, six transcripts stayed unhanded under `.set/copilot/`, the largest 18 500
words, with no input record anywhere pointing at them.

#### Scenario: The configured command runs after archival

- **WHEN** a meeting-mode capture stops with `copilot.handoverCommand` configured
- **THEN** the transcript is archived, the derived artifacts are written, and only then is the
  command run, with the archived paths available to it

#### Scenario: A failing command does not lose the handover

- **WHEN** the configured command exits non-zero, cannot be executed, or exceeds its time limit
- **THEN** the failure is reported and the archived transcript path is still returned, with the
  archive left intact

#### Scenario: No command configured leaves the handover unchanged

- **WHEN** a meeting-mode capture stops with no `copilot.handoverCommand` configured
- **THEN** the handover behaves exactly as before, with nothing extra run and nothing extra reported

### Requirement: The meeting-copilot stop flow surfaces the saved transcript

The `meeting-copilot` skill's stop flow SHALL trigger the archival handover and SHALL report the saved
transcript paths in its closing summary, so the operator (or a follow-up processing step) can find the full
meeting transcript after the session. The summary SHALL name the readable transcript as the source intended
for downstream knowledge processing, and the raw JSONL as the archive of record.

The skill SHALL additionally state two facts about those artifacts, both of which a project
otherwise learns by forking the skill and writing them down itself:

- **why `--print` is not the way to hand a meeting transcript over** — it replays the whole
  transcript back into the session as if freshly spoken, which is the failure the handover
  invariant exists to prevent; and
- **that the raw `.jsonl` holds flush fragments, not sentences**, so any post-processing reads the
  readable `.md`, which is the artifact the stitch produced for exactly that purpose.

#### Scenario: Stop summary names the saved file

- **WHEN** `/meeting-copilot stop` runs
- **THEN** the closing summary includes the archived transcript's path alongside the meeting summary

#### Scenario: Stop summary points knowledge processing at the readable transcript

- **WHEN** `/meeting-copilot stop` runs and the derived artifacts were produced
- **THEN** the closing summary names the readable transcript as the source for note-taking and knowledge
  extraction, and the raw JSONL as the archive

#### Scenario: The skill states why the transcript is not printed

- **WHEN** the stop flow's instructions are read
- **THEN** they forbid `--print` for a meeting transcript and give the reason (it replays the whole
  transcript into the session), rather than leaving the prohibition unexplained

#### Scenario: The skill warns that the raw JSONL is fragments

- **WHEN** the stop flow's instructions name the three artifacts
- **THEN** they state that the raw JSONL consists of flush fragments and that downstream processing
  reads the readable `.md`

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

### Requirement: A project command may run after a dictation handover

The dictation stop path (`stop --print`) SHALL support its own configured project command,
`copilot.dictationHandoverCommand`, run **after** the dictated text was emitted and the transcript
archived, and only when something was archived. It SHALL receive the archived transcript path as
`SET_COPILOT_TRANSCRIPT` and the runtime directory as `SET_COPILOT_DIR` through the environment, and
no derived-artifact paths, because a dictation produces none. It SHALL be a separate key from
`copilot.handoverCommand`: the meeting command SHALL NOT run on a dictation stop, and the dictation
command SHALL NOT run on a meeting stop. An absent or empty value SHALL run nothing; a value that is
not a string SHALL be ignored with a warning naming the key.

The command SHALL NOT be able to fail the handover: a non-zero exit, a missing executable, or
exceeding its 60-second limit SHALL be reported with the archived path, and the archive SHALL stay
intact — the same posture `copilot.handoverCommand` takes, because the rename is the invariant and
everything after it is a convenience.

Dictation transcripts land in the gitignored runtime directory, and lifting them into a project's
inputs was left to a later manual step. Measured in a consumer project: the lift script existed and
nothing called it, every saved dictation came from a hand-run, and the ones nobody ran it for were
simply gone — silently, because an inputs tree with no dictations in it looks exactly like a project
where nobody dictated.

#### Scenario: The command runs after print and archive

- **WHEN** a dictation stop runs with `copilot.dictationHandoverCommand` configured and a non-empty
  transcript
- **THEN** the dictated text is emitted, the transcript is archived, and only then is the command run
  with `SET_COPILOT_TRANSCRIPT` naming the archived file

#### Scenario: Nothing archived, nothing run

- **WHEN** a dictation stop finds no transcript, or an empty one
- **THEN** the command is not run

#### Scenario: The keys do not cross paths

- **WHEN** only `copilot.handoverCommand` is configured and a dictation stop runs
- **THEN** no project command runs on that stop

#### Scenario: A failing command does not lose the dictation

- **WHEN** the configured command exits with status 3
- **THEN** a report naming `copilot.dictationHandoverCommand`, the failure, and the intact archived
  path is emitted, and the transcript remains archived

### Requirement: The dictation hand-off never speaks inside the dictated message

The output of `copilot.dictationHandoverCommand` SHALL NOT reach the stream that carries the dictated
text. Its stdout and stderr SHALL be captured and re-emitted on stderr, one line at a time, each
non-blank line prefixed `[set-copilot] handover: `; its failure report SHALL likewise go to stderr
with the `[set-copilot]` prefix. This is the one behaviour in which it differs from
`copilot.handoverCommand`, whose output is inherited unchanged.

On the dictation path stdout is the channel the user's spoken words travel on, and whatever the
consumer reads there it reads as part of the user's instruction. A project script announcing where
it filed the transcript would splice a sentence the user never said into their own message — a
corruption with no recording to go back to. Re-emitting on stderr keeps the report visible to the
operator, and the prefix is what tells a reader, human or model, that the line is the tooling
talking.

#### Scenario: The command's stdout stays out of the message

- **WHEN** the configured command prints `saved to inputs/dictation/x.md` on stdout during a dictation
  stop
- **THEN** stdout carries only the dictated text, and stderr carries
  `[set-copilot] handover: saved to inputs/dictation/x.md`

#### Scenario: Blank lines are not forwarded

- **WHEN** the configured command prints blank lines among its output
- **THEN** only the non-blank lines are re-emitted, each with the prefix
