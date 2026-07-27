## ADDED Requirements

### Requirement: Runtime state faults are detected and reported

The repair workflow SHALL inspect a project's runtime dirs and report the state faults a capture
or wall can leave behind, distinct from the audio-chain probing `doctor` performs. It SHALL
cover at least: a `capture.pid` whose process is gone, a live-named transcript with no running
capture (a meeting never handed over), a `wall.pid` whose process is gone, and an archive whose
transcripts have never been stitched. Each fault SHALL be reported with the evidence that
identified it.

#### Scenario: An unconsumed transcript is found

- **WHEN** a runtime dir holds a live-named transcript and no running capture
- **THEN** it is reported as a meeting that was never handed over, with its line count and
  runtime dir

#### Scenario: A stale PID claim is found

- **WHEN** a `capture.pid` or `wall.pid` names a process that no longer exists
- **THEN** it is reported as a stale claim, naming which file and which PID

#### Scenario: A clean project reports clean

- **WHEN** no fault is present
- **THEN** the workflow says so plainly rather than inventing work

### Requirement: A live capture is never disturbed

The workflow SHALL verify that a PID is actually dead before reporting or clearing its claim,
and SHALL NOT stop, clear, or archive anything belonging to a running capture or a running wall.
A runtime dir with a live capture SHALL be reported as in use and otherwise left alone.

#### Scenario: A running capture is left alone

- **WHEN** a runtime dir's `capture.pid` names a live process
- **THEN** it is reported as in use, and nothing in that dir is modified

#### Scenario: A running wall's event log is not rotated

- **WHEN** a wall is serving a runtime dir
- **THEN** its event log is not rotated or truncated

### Requirement: Repair distinguishes what it may fix from what it may only report

The workflow SHALL fix only what is safely reversible and SHALL report everything else for a
human decision. Handing over an unconsumed transcript SHALL go through the existing exactly-once
handover rather than any new path, so a repair can never produce a second, divergent way to
consume a transcript.

#### Scenario: An unconsumed transcript is handed over through the normal path

- **WHEN** the operator accepts the repair for a transcript that was never handed over
- **THEN** it is archived by the existing handover, exactly once, and its artifacts are produced
  as a normal stop would

#### Scenario: A destructive action is not taken unprompted

- **WHEN** a fault's only remedy would delete or overwrite data
- **THEN** it is reported with the suggested command, and nothing is deleted or overwritten

### Requirement: Repair hands off content questions

The workflow SHALL stay mechanical. Once state is sound it SHALL point at the content workflow
for reading transcripts and recovering knowledge, rather than reading them itself.

#### Scenario: Repair ends by naming the content step

- **WHEN** repair finishes and unreviewed transcripts remain
- **THEN** it reports how many, and directs the operator to the content recovery workflow

#### Scenario: Repair does not read transcripts for content

- **WHEN** repair runs
- **THEN** it reports counts and state only, and does not analyse what was said
