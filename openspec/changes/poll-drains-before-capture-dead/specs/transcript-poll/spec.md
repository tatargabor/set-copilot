## Purpose

The long-poll contract between a capture and the session consuming it: what a batch
contains, what makes a poll return early, and what a consumer is owed when the capture
ends.

## IN SCOPE

- What a poll returns while a capture is alive.
- What a poll returns once the capture is gone.
- The offset bookkeeping that makes a line deliverable exactly once.

## OUT OF SCOPE

- What the consumer does with a batch — that is the skill's judgement, and deliberately
  not engine behaviour.
- How the transcript is produced. A replay owns a runtime dir under the same rules as a
  capture, and this contract is written so that it cannot tell them apart.

## ADDED Requirements

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
