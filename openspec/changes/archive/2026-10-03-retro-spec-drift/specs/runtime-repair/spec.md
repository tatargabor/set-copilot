## MODIFIED Requirements

### Requirement: Runtime state faults are detected and reported

The repair workflow SHALL inspect a project's runtime dirs and report the state faults a capture
or wall can leave behind, distinct from the audio-chain probing `doctor` performs. It SHALL
cover at least: a `capture.pid` whose process is gone, a live-named transcript with no running
capture (a meeting never handed over), a `wall.pid` whose process is gone, a `mirror.pid` whose
process is gone or whose follower is still alive in a dir whose session has ended, and an archive
whose transcripts have never been stitched. Each fault SHALL be reported with the evidence that
identified it. A live orphaned follower SHALL be stopped only through `set-copilot stop` (which
drains what is pending first) or after the operator confirms the session is over — never
unprompted.

#### Scenario: An unconsumed transcript is found

- **WHEN** a runtime dir holds a live-named transcript and no running capture
- **THEN** it is reported as a meeting that was never handed over, with its line count and
  runtime dir

#### Scenario: A stale PID claim is found

- **WHEN** a `capture.pid`, `wall.pid` or `mirror.pid` names a process that no longer exists
- **THEN** it is reported as a stale claim, naming which file and which PID

#### Scenario: A clean project reports clean

- **WHEN** no fault is present
- **THEN** the workflow says so plainly rather than inventing work

#### Scenario: A live follower outliving its session is reported

- **WHEN** a `mirror.pid` names a live follower in a runtime dir whose session has ended
- **THEN** it is reported with its PID as an orphaned follower, and it is stopped only through
  `set-copilot stop` or on the operator's confirmation
