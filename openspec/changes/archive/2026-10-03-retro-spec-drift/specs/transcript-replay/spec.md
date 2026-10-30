## MODIFIED Requirements

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

## ADDED Requirements

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
