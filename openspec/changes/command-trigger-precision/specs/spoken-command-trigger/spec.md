## IN SCOPE

- Which channels may open a command span
- The utterance-start condition on the opening word
- The default opening vocabulary
- A replay command that counts command events over a recorded transcript

## OUT OF SCOPE

- The closing words, the extraction of the instruction, and the abandonment caps (unchanged)
- Speaker separation inside the system channel
- Any change to how the transcript writer flushes lines

## ADDED Requirements

### Requirement: Only configured channels open a command
The fast lane SHALL open a command span only for a speaker listed in `copilot.fastLane.channels`.
The default SHALL be `["mic"]`. Speech from any other channel SHALL neither open nor close a span,
and SHALL produce no `command` or `command-abandoned` event.

#### Scenario: Opener on the system channel
- **WHEN** the `system` speaker says "Copilot, draw the three layers, csináld." with default config
- **THEN** no `command` and no `command-abandoned` event is emitted

#### Scenario: A completed bracket from a remote participant
- **WHEN** the `system` speaker says "Start the export and then stop it there." with `start` configured as an opening word
- **THEN** no `command` event is emitted

#### Scenario: Opting a channel back in
- **WHEN** `channels` is `["mic","system"]` and the `system` speaker says "Copilot, draw it, csináld."
- **THEN** a `command` event is emitted for `system`

#### Scenario: Malformed channels value
- **WHEN** `channels` is not a list of non-empty strings
- **THEN** the default `["mic"]` applies

### Requirement: The opening word must begin an utterance
When `utteranceStart` is true (the default), an opening word SHALL open a span only if no letter or
digit precedes it in that speaker's speech since the later of: the last sentence terminator
(`.`, `?`, `!`), or a gap of at least `utterancePauseMs` (default 1500) between that speaker's
consecutive pieces of speech. Punctuation and whitespace before the opener SHALL NOT disqualify it.
The matching SHALL stay whole-word, case-insensitive and accent-insensitive.

#### Scenario: The name used mid-sentence
- **WHEN** the mic speaker says "Updated it, at the meeting copilot startup." and then speaks on for a minute
- **THEN** no span opens and no `command-abandoned` event is emitted

#### Scenario: Address at the start of a sentence
- **WHEN** the mic speaker says "Right. Copilot, draw the three layers, csináld."
- **THEN** a `command` event is emitted whose text is the instruction between the markers

#### Scenario: Address after a pause, split across tokens
- **WHEN** the mic speaker pauses for at least `utterancePauseMs`, then says " Copi", "lot", " summarise it", " csináld" as separate pieces
- **THEN** a `command` event is emitted with text "summarise it"

#### Scenario: Utterance start disabled
- **WHEN** `utteranceStart` is false and the mic speaker says "the meeting copilot draws it csináld"
- **THEN** a `command` event is emitted (the previous matching behaviour)

### Requirement: Default opening words exclude ordinary verbs
The default `copilot.fastLane.start` SHALL be `["copilot"]`. A configured list SHALL replace it as
before. The default closing words SHALL be unchanged.

#### Scenario: "start" in ordinary speech
- **WHEN** the mic speaker says "Start with the second slide. Then we stop." with default config
- **THEN** no span opens

### Requirement: A replay command measures false openings
`scripts/fast-lane-replay.ts <transcript.jsonl>` SHALL feed the transcript's speech lines through
the fast lane under the resolved project config, in file order, per speaker. It SHALL print the
number of `command` and `command-abandoned` events per channel. It SHALL never write to the
transcript or the runtime dir.

#### Scenario: Counting a recorded meeting
- **WHEN** the script runs on a transcript JSONL
- **THEN** it prints `command` and `command-abandoned` counts per speaker and exits 0, leaving the input file unchanged
