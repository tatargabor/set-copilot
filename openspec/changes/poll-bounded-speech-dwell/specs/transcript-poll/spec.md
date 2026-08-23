## ADDED Requirements

### Requirement: A poll returns once enough new speech has accumulated

The poll SHALL return when the number of new **speech** lines reaches a configured
threshold, in addition to the existing early-return triggers. A threshold of zero SHALL
disable this behaviour, leaving the poll's returns exactly as they were.

The bound this gives is the point: without it, a line spoken in the middle of continuous
speech waits for the next pause, which was measured at 30.7 s on average during a
presentation — half a minute in which the copilot has not been shown the thing it exists
to react to.

#### Scenario: Accumulated speech ends the wait

- **WHEN** the threshold is reached by new speech lines during a poll's wait
- **THEN** the poll returns with those lines, without waiting for a pause or the full wait

#### Scenario: Below the threshold the poll keeps waiting

- **WHEN** fewer than the threshold's worth of new speech lines have arrived and no other
  trigger fired
- **THEN** the poll keeps waiting

#### Scenario: Non-speech does not count toward the threshold

- **WHEN** the new lines are non-speech events rather than spoken lines
- **THEN** they do not count toward the threshold, because a run of events is not something
  to react to

#### Scenario: A threshold of zero preserves the previous behaviour exactly

- **WHEN** the threshold is configured as zero
- **THEN** the poll returns only on the triggers it returned on before

#### Scenario: The existing triggers still fire first

- **WHEN** a question arrives before the threshold is reached
- **THEN** the poll returns at once, as it did before
