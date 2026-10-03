# transcript-replay Specification

## Purpose
Plays a recorded scenario into a runtime dir's transcript as if it were a live capture,
so the whole consumer path — poll, skill, wall, mirror — can be exercised repeatably
without a microphone and without changing a line of the code under test.

## Requirements

### Requirement: A replay is indistinguishable from a live capture to its consumers

The replay SHALL write scenario lines into the runtime dir's transcript file in the same
JSONL line shape a capture writes, and SHALL hold the runtime dir's capture PID file for
the duration of the run. A consumer polling that runtime dir MUST NOT need any
configuration, flag, or code path that differs from a live capture.

#### Scenario: A polling consumer receives replayed lines as ordinary transcript lines

- **WHEN** a replay is running against a runtime dir and a consumer long-polls that dir
- **THEN** the consumer receives the scenario's lines as it would receive live capture
  lines, with the same fields and the same early-return behaviour on urgent, question,
  and silence events

#### Scenario: The consumer does not see a dead capture while the replay runs

- **WHEN** a replay is in progress
- **THEN** the runtime dir's capture PID file names the live replay process, so a
  consumer's liveness check reports the capture as alive

#### Scenario: The end of the scenario ends the capture

- **WHEN** the replay reaches the last line of the scenario
- **THEN** it releases the capture PID file, so the consumer observes the capture ending
  exactly as it would when a real capture stops

### Requirement: Playback is paced by the scenario's own timestamps

The replay SHALL schedule each line at the run's start plus the line's scenario timestamp divided
by the speed, so a scenario reproduces the rhythm of the speech it represents — including the
silences between utterances. Every deadline SHALL be computed from the run's start, never from
the moment the previous line was actually written: a late write SHALL NOT shift any later line,
so the player catches up instead of stretching the run.

#### Scenario: Gaps between utterances are reproduced

- **WHEN** two consecutive scenario lines are separated by N milliseconds of timestamp
- **THEN** at speed 1 the replay writes the second line approximately N milliseconds
  after the first

#### Scenario: Two channels interleave as recorded

- **WHEN** a scenario contains lines on both the mic and the system channel whose
  timestamps overlap
- **THEN** the replay emits them in the scenario's recorded order, preserving the
  interleaving rather than serialising one channel after the other

#### Scenario: A late write does not shift the rest of the run

- **WHEN** writing one line is delayed past its deadline
- **THEN** every later line SHALL still be due at its original offset from the run's start

### Requirement: Speed is adjustable, and a sped-up run may not claim latency

The replay SHALL accept a speed multiplier, defaulting to real time. A speed other than
real time SHALL be recorded in the run's own record so that any figure derived from
wall-clock time can be rejected as invalid.

#### Scenario: Real time is the default

- **WHEN** a replay is started without an explicit speed
- **THEN** it plays at real time

#### Scenario: A faster run is marked as such

- **WHEN** a replay runs at a speed other than real time
- **THEN** the run record states the speed used, and any consumer of that record treats
  latency figures from it as invalid

#### Scenario: Maximum speed drains the scenario without waiting

- **WHEN** a replay is started at the "as fast as possible" setting
- **THEN** lines are written without inter-line delay, and the run record marks the run
  as not real time

### Requirement: A replay never collides with a live capture

The replay SHALL refuse to start when the target runtime dir already has a live capture
or a live replay, and SHALL reclaim a stale PID file left by a dead process — the same
rule that governs a second capture in one runtime dir.

#### Scenario: A live capture blocks a replay

- **WHEN** a replay is started against a runtime dir whose capture PID names a live
  process
- **THEN** the replay refuses to start and names the owning process, leaving the
  transcript untouched

#### Scenario: A stale PID file is reclaimed

- **WHEN** a replay is started against a runtime dir whose capture PID names a process
  that is gone
- **THEN** the replay reclaims the PID file and proceeds

#### Scenario: An unconsumed transcript is not silently overwritten

- **WHEN** a replay is started against a runtime dir that still holds a transcript
  nobody handed over
- **THEN** the previous transcript is archived rather than truncated, following the
  same hand-over-exactly-once rule the capture path follows

### Requirement: A run reports where it stands

The replay SHALL report its progress while it runs — how far into the scenario it is,
what is being said, and which section of the source material that line belongs to — so
an operator watching a session can see what the copilot is reacting to.

#### Scenario: Progress is visible during the run

- **WHEN** a replay writes a scenario line
- **THEN** it reports the elapsed scenario time, the line's section, the speaker, and
  the text being played

#### Scenario: The run ends with a summary

- **WHEN** a replay finishes
- **THEN** it reports the scenario played, the speed used, the number of lines emitted,
  and the wall-clock duration of the run

### Requirement: Only the playable line reaches the transcript

Each script entry wraps the transcript line or event it plays. The replay SHALL write exactly that
wrapped line or event to the transcript, as the scenario records it: authoring metadata carried by
the entry (such as the section of the source material it belongs to) SHALL appear only in the
operator's progress output, never in the transcript — a copilot handed a structured outline of the
talk it is supposed to follow by ear would be a copilot nobody ships. The per-line flags a capture
derives (`urgency`, `question`, `topics`) SHALL be written as the scenario records them and SHALL
NOT be recomputed from the project's current detection configuration, so a scenario stays an
identical measuring stick across configuration changes.

#### Scenario: Entry metadata is not written

- **WHEN** a script entry carries a `section` alongside its line
- **THEN** the written transcript line SHALL NOT carry the `section`, and the operator's progress
  output MAY show it

#### Scenario: Detection flags are not recomputed

- **WHEN** a project changes its question-detection pattern and replays an unchanged scenario
- **THEN** the replayed lines SHALL carry the same `question` flags as before

### Requirement: The player records its own lateness

The replay SHALL record in its run record the worst lateness it suffered against its own schedule,
and SHALL warn the operator once when that lateness passes a warning threshold — a run in which
the player itself fell behind would measure the player, not the copilot.

#### Scenario: A player that falls behind says so

- **WHEN** a line is written later than its deadline by more than the warning threshold
- **THEN** the replay SHALL print one warning, and the run record SHALL carry the maximum
  lateness observed
