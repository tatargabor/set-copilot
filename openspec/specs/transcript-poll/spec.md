# transcript-poll Specification

## Purpose
The long-poll contract between a capture and the session consuming it: what a batch
contains, what makes a poll return early, and what a consumer is owed when the capture
ends.

## Requirements

### Requirement: A poll returns the lines written since the consumer last read

The poll SHALL return transcript lines appended after the consumer's recorded offset, and
SHALL advance that offset only for lines it returned, so every line is delivered exactly
once across successive polls.

#### Scenario: New lines are delivered once

- **WHEN** lines are appended after the last poll and the consumer polls again
- **THEN** those lines are returned, and a subsequent poll does not return them again

#### Scenario: A quiet capture yields an empty batch

- **WHEN** no lines were appended within the poll's wait
- **THEN** the poll returns without content, leaving the offset unchanged

### Requirement: A poll returns early on a line that should not wait

The poll SHALL return as soon as a batch contains a line the consumer should act on
immediately rather than at the end of the wait — an urgent line, a question, a direct
address to the copilot, or the silence that closes a spoken thought.

#### Scenario: A question does not wait out the poll

- **WHEN** a question line is appended during a poll's wait
- **THEN** the poll returns at once with the batch containing it

#### Scenario: A direct address does not wait out the poll

- **WHEN** a line addressed to the copilot is appended during a poll's wait
- **THEN** the poll returns at once, rather than leaving an instruction behind an ambient gate

### Requirement: The end of a capture never discards unread lines

When the capture owning the runtime dir is gone, the poll SHALL first deliver every
remaining unread line, and SHALL report the capture as dead only once there is nothing
left to hand over.

This is what the requirement protects against, stated because the defect it fixes was
invisible: the last thing said before a capture ends is where a meeting's decisions are
made, and a consumer cannot distinguish a capture that ended quietly from one that ended
with words it never got.

#### Scenario: Unread lines are delivered before the death notice

- **WHEN** a consumer polls a runtime dir whose capture has exited and whose transcript
  holds lines past the consumer's offset
- **THEN** those lines are returned, and the offset advances past them

#### Scenario: The death notice follows, not replaces, the content

- **WHEN** the consumer polls again after the drained batch
- **THEN** the capture is reported as dead, so a consumer's loop still terminates

#### Scenario: A capture that ends with nothing unread reports death at once

- **WHEN** a consumer polls a runtime dir whose capture has exited and whose transcript
  holds nothing past the consumer's offset
- **THEN** the capture is reported as dead immediately

#### Scenario: A drained batch is not delivered twice

- **WHEN** the lines of a dead capture have been drained by one poll
- **THEN** a further poll reports only that the capture is dead, and does not repeat them

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
