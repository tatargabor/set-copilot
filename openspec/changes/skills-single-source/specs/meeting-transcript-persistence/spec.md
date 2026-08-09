## ADDED Requirements

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

## MODIFIED Requirements

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
