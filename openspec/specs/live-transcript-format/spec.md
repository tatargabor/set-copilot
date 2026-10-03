# live-transcript-format Specification

## Purpose
The line format a running capture writes into its transcript JSONL: when a channel's speech is
cut into a line, which fields a line carries so a reader can rebuild what the cut destroyed, how
the per-line flags (`topics`, `urgency`, `question`, `command`) are detected, and which non-speech
events share the stream.

## Requirements

### Requirement: A channel's speech is cut into lines by that channel's own rules

The writer SHALL accumulate only final, non-empty recognised tokens, buffered per channel
(`mic`, `system`), and SHALL write a channel's buffer as a line on exactly one of three
conditions:

- **a sentence boundary** — a terminator (`.`, `?`, `!`, `…`) followed by whitespace or at the
  end of the buffer; the line carries every complete sentence up to the last such terminator,
  and the remainder stays buffered;
- **that channel's own silence** — no new final token from that channel for more than the
  silence timeout (3 s);
- **overflow** — the buffer holding more than the token cap (80 tokens).

When the capture closes, every non-empty buffer SHALL be written out. Non-final tokens SHALL
never reach a line.

#### Scenario: A sentence end writes the line

- **WHEN** the `mic` channel receives the final tokens `Hello`, ` world`, `.`
- **THEN** one line is written with `"text":"Hello world."` and `"speaker":"mic"`

#### Scenario: An unfinished sentence is held back

- **WHEN** a channel has received final tokens with no sentence terminator and less than 3 s
  have passed since its last token
- **THEN** nothing is written for that channel yet

#### Scenario: A non-final token is ignored

- **WHEN** a token arrives marked non-final
- **THEN** it contributes nothing to any buffer or line

#### Scenario: A buffer that never gets punctuation is safety-flushed

- **WHEN** a channel accumulates more than 80 final tokens without a sentence terminator
- **THEN** the buffer is written as a line marked `partial`

#### Scenario: The speaker's own pause cuts the line

- **WHEN** a channel has buffered text and receives no final token for more than 3 s
- **THEN** that buffer is written as a line marked `partial`

### Requirement: A speaker change never flushes the other channel

Speech on one channel SHALL NOT cause the other channel's buffer to be written. Each channel's
buffer SHALL be bounded only by its own sentence, silence and overflow rules.

This replaced a "natural turn-taking" flush that only holds for a single diarized stream. With
two independent channels speech genuinely overlaps, and the constant backchannel ("mhm", "aha")
on one channel severed the other's sentence wherever its token stream happened to stand — that
is, mid-word. Measured on a three-hour two-channel recording: 460 mid-word cuts, 44% of them
immediately after a cross-channel interjection, 154 after a backchannel of three words or less.
Dictation never showed it, because a mic-only capture has no second channel.

#### Scenario: A backchannel does not cut the other channel's sentence

- **WHEN** the `system` channel has buffered `we decided to postpone the speci` and the `mic`
  channel then says `Mhm.`
- **THEN** the `mic` line is written, and the `system` buffer is NOT written until its own
  sentence end, silence, or overflow — so `specification` is not split in two

### Requirement: Recognised tokens are concatenated, never space-joined

The writer SHALL append each recognised token's text to the buffer verbatim, because the
recogniser carries the word boundary as a leading space on the token; it SHALL NOT insert a
separator between tokens. The written line's text SHALL be trimmed at both ends.

#### Scenario: Sub-word tokens rejoin into one word

- **WHEN** the tokens ` speci` and `fication.` arrive on one channel
- **THEN** the line text contains `specification.` with no space inside the word

### Requirement: A line records where its utterance began

Each line SHALL carry `ts`, the timestamp of its last token, and SHALL carry `startTs`, the
timestamp of its first token, whenever the two differ. With two channels, completion order is
not speaking order — a long utterance completes after several short ones from the other side —
so a reader that wants the conversation in spoken order sorts on `startTs`.

#### Scenario: A multi-token line carries its start

- **WHEN** a line's first token is at 1000 ms and its last at 4000 ms
- **THEN** the line carries `"startTs":1000` and `"ts":4000`

#### Scenario: A single-instant line omits the redundant field

- **WHEN** a line's first and last token carry the same timestamp
- **THEN** the line carries `ts` and no `startTs`

### Requirement: A cut without a sentence boundary is marked, and so is how it resumes

A line written by the silence or overflow rule SHALL carry `"partial":true`. The next line
written for the same channel SHALL carry `"cont":true`, and SHALL additionally carry
`"midWord":true` when its first token did not begin with whitespace — meaning the two lines'
adjoining words are halves of one word. A line written on a sentence boundary SHALL carry
neither `partial` nor, unless it resumes a partial line, `cont`.

The recogniser's leading space is the only evidence of a word boundary, and the line text is
trimmed when written, so the fact SHALL be recorded when the resuming token arrives, or it is
lost for good.

#### Scenario: A mid-word cut and its continuation

- **WHEN** a channel's buffer ending `…a speci` is cut by its own silence, and the channel
  resumes with the token `fication.`
- **THEN** the first line carries `"partial":true`, and the next carries `"cont":true` and
  `"midWord":true`

#### Scenario: A continuation that starts a new word

- **WHEN** a severed channel resumes with the token ` and then.`
- **THEN** the resuming line carries `"cont":true` and no `midWord`

### Requirement: A meeting line carries the knowledge topics it mentions

In meeting mode, each line SHALL carry `topics`: the labels of every keyword-index entry with a
stem matching the line text, deduplicated and in index order. The field SHALL be omitted when
nothing matches. A stem SHALL match case-insensitively from a word start, with the word start
defined over Unicode letters and digits, and SHALL NOT require a word end, so an inflected or
agglutinated form still matches its stem. When a decision-id prefix is configured, a reference
such as `DEC-3`, `dec 3` or `DEC.12` SHALL be added as the normalised label `DEC-003` after the
keyword matches. A dictation (mic-only) capture SHALL carry no `topics`.

#### Scenario: An inflected form matches its stem

- **WHEN** the index holds a topic with the stem `invoic` and the line says `the invoicing run`
- **THEN** the line carries that topic in `topics`

#### Scenario: A stem inside another word does not match

- **WHEN** the stem occurs only in the middle of a longer word
- **THEN** the topic is not added

#### Scenario: No match omits the field

- **WHEN** no stem matches the line
- **THEN** the line carries no `topics` field

### Requirement: Urgency and question flags come from configured patterns

A line whose text matches a `detect.urgency` pattern SHALL carry `"urgency":"high"`, and one
matching a `detect.question` pattern SHALL carry `"question":true`. Patterns SHALL be matched
case-insensitively with Unicode semantics. A non-empty configured list SHALL replace the
corresponding default list wholesale; an absent or empty list SHALL fall back to the defaults.
The defaults SHALL cover English and Hungarian, plus a language-independent trailing-`?` rule for
questions.

#### Scenario: Default patterns flag an English problem report

- **WHEN** the default patterns are in effect and a line says `The export is broken again.`
- **THEN** the line carries `"urgency":"high"`

#### Scenario: A trailing question mark is a question in any language

- **WHEN** a line's text ends in `?`
- **THEN** the line carries `"question":true`

#### Scenario: A project's own patterns replace the defaults

- **WHEN** `detect.urgency` is configured as a non-empty list
- **THEN** only those patterns set `urgency`, and the default patterns no longer do

### Requirement: An invalid detection pattern is dropped, never fatal

Detection patterns are user-supplied. A pattern that does not compile SHALL be dropped with a
warning on stderr naming the pattern and the `detect.<kind>` it came from; the remaining
patterns of that kind SHALL still apply, and the capture SHALL continue. When no pattern of a
kind compiles, that flag SHALL simply never be set.

#### Scenario: One bad pattern among good ones

- **WHEN** `detect.urgency` contains an unbalanced-parenthesis pattern and a valid one
- **THEN** a warning is printed for the bad pattern, the capture starts, and lines matching the
  valid pattern still carry `"urgency":"high"`

### Requirement: Naming the copilot on the mic channel marks the line as a command

A line SHALL carry `"command":true` when it is on the `mic` channel and its text contains one of
the names the copilot answers to (`copilot.names`, default `["copilot"]`) or matches a raw
`detect.command` pattern; names and patterns SHALL be merged, not one overriding the other. A
name SHALL be treated as a literal word, regex-escaped, and SHALL match from a word start defined
over Unicode letters and digits with no word-end requirement, so a suffixed form (`copilotot`,
`copilottal`) matches. A name on the `system` channel SHALL NOT mark the line: that is someone
else's meeting, not an instruction.

Only address forms belong in the name list: an imperative ("draw this") is usually aimed at
another person in a meeting, and a false positive costs a wasted reaction.

#### Scenario: The mic speaker names the copilot

- **WHEN** the `mic` channel says `Copilot, show the timeline.`
- **THEN** the line carries `"command":true`

#### Scenario: A suffixed form still matches

- **WHEN** the `mic` channel says `Kérdezzük meg a copilotot.`
- **THEN** the line carries `"command":true`

#### Scenario: The name inside another word does not match

- **WHEN** the configured name appears only after other letters of the same word
- **THEN** the line carries no `command` field

#### Scenario: The name on the system channel is ignored

- **WHEN** the `system` channel says `Copilot, show the timeline.`
- **THEN** the line carries no `command` field

#### Scenario: A name is a word, not a pattern

- **WHEN** `copilot.names` contains a name with regex metacharacters, such as `c++`
- **THEN** it matches the literal text and does not compile as a quantifier

### Requirement: One silence event is written per silence period

Once any final token has arrived, and when both channels' buffers are empty and no final token
has arrived on any channel for more than the silence timeout, the writer SHALL append exactly one
`{"type":"silence","duration_ms":N,"ts":T}` event, where `duration_ms` is how long the silence
had lasted when written and `ts` is the timestamp of the last speech before it. No further
silence event SHALL be written until speech resumes. No silence event SHALL be written before
the first speech.

#### Scenario: A long pause yields one event

- **WHEN** speech stops and the capture stays quiet for several silence-timeout periods
- **THEN** exactly one silence event is written for that pause

#### Scenario: The next pause gets its own event

- **WHEN** speech resumes after a silence event and then stops again for longer than the timeout
- **THEN** a second silence event is written

### Requirement: A transcription reconnect is recorded in the stream

When a channel's transcription connection drops and is re-established, the capture SHALL append
`{"type":"reconnect","speaker":<channel>,"downtime_ms":N,"replayed_audio_ms":M,"ts":T}` to the
same stream as the speech, so a reader can see that a stretch of the meeting may be missing
rather than reading an unbroken transcript with a silent hole.

#### Scenario: A dropped socket leaves a visible marker

- **WHEN** the `system` channel's connection drops for 4 s and reconnects
- **THEN** a `reconnect` event naming `system` and its downtime is appended to the transcript
