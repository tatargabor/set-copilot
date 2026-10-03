# transcript-poll Specification

## Purpose
The long-poll contract between a capture and the session consuming it: what a batch
contains, what makes a poll return early, and what a consumer is owed when the capture
ends.

## Requirements

### Requirement: A poll returns the lines written since the consumer last read

The poll SHALL return transcript lines appended after the consumer's recorded offset, and
SHALL advance that offset past every line it read in that poll — the lines it returned and the
lines its batch filter deliberately dropped — so every line is delivered at most once and every
surviving line exactly once across successive polls. The offset SHALL be a count of transcript
lines kept in the runtime dir (`poll-offset`), independent of byte length. Lines appended while
the poll was deciding to return SHALL be included in the batch it returns.

A dropped line is consumed, not deferred: an echo or an empty line that was filtered once is not
reconsidered by the next poll, which would otherwise re-evaluate the same noise forever.

#### Scenario: New lines are delivered once

- **WHEN** lines are appended after the last poll and the consumer polls again
- **THEN** those lines are returned, and a subsequent poll does not return them again

#### Scenario: A quiet capture yields an empty batch

- **WHEN** no lines were appended within the poll's wait
- **THEN** the poll returns without content, leaving the offset unchanged

#### Scenario: A filtered line is consumed with the batch

- **WHEN** a batch contains an echo line that the filter drops
- **THEN** the offset advances past it, and no later poll returns it

### Requirement: A poll returns early on a line that should not wait

The poll SHALL return as soon as its unread batch contains a line the consumer should act on
immediately rather than at the end of the wait — an urgent line (`"urgency":"high"`), a question
(`"question":true`), a direct address to the copilot (`"command":true`), a fast-lane `command` or
`command-abandoned` event, or the silence that closes a spoken thought. A silence event SHALL end
the wait only when the unread batch also contains a speaker-attributed line (speech, or an event
naming a channel): a silence with nothing said before it closes no thought.

The fast-lane events return for the same reason a direct address does — they are instructions,
and the inference gate the poll waits for has nothing to do with them. An abandonment is included
because the operator needs to know at once that their command did not take.

#### Scenario: A question does not wait out the poll

- **WHEN** a question line is appended during a poll's wait
- **THEN** the poll returns at once with the batch containing it

#### Scenario: A direct address does not wait out the poll

- **WHEN** a line addressed to the copilot is appended during a poll's wait
- **THEN** the poll returns at once, rather than leaving an instruction behind an ambient gate

#### Scenario: A fast-lane event does not wait out the poll

- **WHEN** a `{"type":"command"}` or `{"type":"command-abandoned"}` event is appended during a
  poll's wait
- **THEN** the poll returns at once with the batch containing it

#### Scenario: A silence that closes speech ends the wait

- **WHEN** the unread batch holds a speech line followed by a silence event
- **THEN** the poll returns at once

#### Scenario: A silence alone does not end the wait

- **WHEN** the unread batch holds only a silence event
- **THEN** the poll keeps waiting

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

### Requirement: The batch is filtered of echoes and empty lines, never of events

Before a batch is returned, or counted toward an early return or a drain, the poll SHALL filter it:

- `silence`, `reconnect`, `command` and `command-abandoned` events SHALL pass through verbatim
  and SHALL never be deduplicated — a reconnect is the only signal that a stretch of the meeting
  may be missing, and a repeated command is a second instruction;
- a speech line whose text, reduced to its Unicode letters and digits, is empty (for example
  `...`) SHALL be dropped;
- a speech line whose reduced text contains, or is contained in, the reduced text of either of
  the two non-empty speech lines before it in the same batch (kept or dropped) SHALL be dropped as a mic/system echo,
  regardless of which channel spoke it;
- any other line with no `text` SHALL be dropped.

The reduction SHALL keep letters and digits of every script; an accent-blind or Latin-only
reduction would collapse non-Latin text to nothing and make every line look like a duplicate.

#### Scenario: A system-channel echo of the mic is dropped

- **WHEN** a batch holds a `mic` line `Let's ship it on Friday.` followed by a `system` line
  `let's ship it on friday`
- **THEN** only the `mic` line is returned

#### Scenario: An ellipsis-only line is dropped

- **WHEN** a batch holds a speech line whose text is `...`
- **THEN** that line is not returned

#### Scenario: A reconnect survives the filter

- **WHEN** a batch holds a `reconnect` event between two speech lines
- **THEN** the reconnect event is returned verbatim

#### Scenario: A dead capture with only noise reports death

- **WHEN** the capture has exited and every unread line is dropped by the filter
- **THEN** the poll reports the capture as dead rather than returning an empty batch

### Requirement: The poll checks for new lines every 250 ms

While waiting, the poll SHALL re-read the transcript and re-evaluate its return triggers at a
250 ms tick. The tick is pure detection latency added to every reaction; the previous 2 s tick
measurably added up to 2 s to every round, while re-reading one small file eight times a second
costs nothing beside that.

#### Scenario: An early-return line is picked up within one tick

- **WHEN** a question line is appended while a poll is waiting
- **THEN** the poll returns within about 250 ms of the append, not at the end of a multi-second
  interval
