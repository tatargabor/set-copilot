## ADDED Requirements

### Requirement: Dictation is emitted as reassembled sentences, not fragments

The dictation stop path SHALL emit the dictated text with its capture-level fragmentation already
undone: word boundaries resolved from the capture's own `cont` / `midWord` markers where present,
and sentences rejoined. The consumer SHALL receive text it can act on directly.

#### Scenario: A continued line is rejoined with the correct separator

- **WHEN** a dictation was flushed mid-utterance and resumes on the next line
- **THEN** the emitted text joins the two parts with a space, or with no separator when the
  resumption began mid-word, according to what the capture recorded

#### Scenario: A single dictation is one block of text

- **WHEN** a dictation produced several transcript lines
- **THEN** the output is the reassembled text, not one entry per line

#### Scenario: Non-speech events do not reach the output

- **WHEN** the dictation transcript contains silence events
- **THEN** they produce no text in the output

### Requirement: The consumer is not asked to reassemble anything

The dictation output SHALL be plain text requiring no parsing, no concatenation, and no
separator decision by the consumer. Instructions telling a consumer to parse the transcript
format and join fields SHALL be removed rather than reworded, because a consumer given raw
fragments has no information with which to choose a separator correctly.

#### Scenario: The output needs no interpretation

- **WHEN** dictation stops with captured speech
- **THEN** the entire output is the user's message, with no structural syntax to strip and no
  fields to join

#### Scenario: Timestamps and speaker labels are absent

- **WHEN** the dictated text is emitted
- **THEN** it carries no timestamps and no speaker labels, which are meeting-transcript furniture
  and would be read as part of the user's message

### Requirement: An empty dictation is reported as such

When no speech was captured, the path SHALL produce no text, so the consumer can report that
nothing was dictated rather than acting on an empty or fabricated message.

#### Scenario: Nothing was said

- **WHEN** dictation stops with an empty or speechless transcript
- **THEN** no text is emitted and the consumer reports that no text was captured

### Requirement: A reassembly failure never loses the dictation

If reassembly fails for any reason, the path SHALL fall back to emitting the raw transcript
contents rather than emitting nothing. A badly joined word boundary is recoverable by the reader;
a silently dropped instruction is not.

#### Scenario: Reassembly fails

- **WHEN** the reassembly step throws or produces no result on a non-empty transcript
- **THEN** the raw transcript contents are emitted instead, and the archival still happens exactly
  once

#### Scenario: The fallback is not silent

- **WHEN** the fallback is used
- **THEN** the condition is reported on the diagnostic channel, so a persistent failure is
  noticeable rather than mistaken for normal output
