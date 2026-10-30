# Spec Delta

## Purpose

A spoken instruction, bracketed between a start word and an end word, taken out of the ambient
transcript and handed to the copilot as a single event without the inference gate — because an
instruction needs no judgement, it should pay none of the latency that judgement costs (measured
end to end at ~33 s from a sentence to an ambient reaction).

## ADDED Requirements

### Requirement: A command is the speech between a start word and an end word

The system SHALL recognise a spoken command only when a configured start word is followed, later
in the same channel's speech, by a configured end word. The command's text SHALL be the speaker's
own raw text between the two markers, markers excluded and trimmed, with its original accents
and case. A start word with no end word SHALL NOT produce a command. When both markers arrive in
the same piece of recognised speech, the command SHALL be produced at once rather than waiting
for further speech.

The closing word is load-bearing, not ceremony: speech has no reliable end-of-thought (the
recogniser's punctuation is a guess, and a speaker who pauses mid-instruction has not finished),
so without a terminator the engine would have to guess when to execute, and the failure mode is
acting on half a sentence. Requiring both words in order is also what makes the trigger
deliberate.

#### Scenario: Only the bracketed words are handed over

- **WHEN** the `mic` channel says `ok so copilot draw the order flow csináld thanks`
- **THEN** a command is produced with the text `draw the order flow`

#### Scenario: Both markers in one piece

- **WHEN** a single recognised piece reads `copilot rajzolj csináld`
- **THEN** a command with the text `rajzolj` is produced immediately

#### Scenario: The opening word alone does nothing

- **WHEN** the speaker says `copilot` and then ordinary speech with no end word
- **THEN** no command is produced

### Requirement: The fast lane reads the token stream, not the written lines

The lane SHALL be fed every final recognised token as it arrives, before the line writer's flush
rules apply, and SHALL keep its own per-channel buffer that no line flush resets. A marker split
across tokens, or an instruction that spans a sentence boundary or a silence flush, SHALL still
be recognised as one command. While no command is open, the per-channel look-back buffer SHALL be
bounded, so a meeting with no command in it does not grow memory.

A line is a flush artefact — sentence punctuation, that speaker's 3 s silence, an 80-token cap —
and none of those rules know where an instruction starts. A marker split by a flush is invisible
to any line-level matcher.

#### Scenario: A marker split across tokens

- **WHEN** the tokens ` Copi` and `lot` arrive, followed by an instruction and the end word
- **THEN** a command is produced

#### Scenario: An instruction that crosses a line flush

- **WHEN** the start word and the first half of an instruction are written as one transcript
  line (a sentence end), and the second half and the end word arrive in the next
- **THEN** one command carrying the whole instruction is produced

### Requirement: Markers match whole words, accent- and case-insensitively

Markers SHALL be matched against speech folded to lowercase with combining accents removed and
every run of non-letter, non-digit characters (over Unicode letters and digits) treated as one
separator. A marker SHALL match only as a whole word: it SHALL NOT match inside a longer word.

#### Scenario: Accent and case variants are one marker

- **WHEN** the end word is configured as `csináld` and the speaker's text contains `CSINALD`
- **THEN** it closes the command, while the extracted instruction keeps the speaker's own
  accented text

#### Scenario: A marker inside a longer word is ignored

- **WHEN** the start word is `start` and the speaker says `we restart the server`
- **THEN** no command is opened

### Requirement: Each channel has its own command span

Command spans SHALL be tracked independently per channel, and a command SHALL be attributed to
the channel that spoke it. Speech on one channel SHALL neither close nor extend the other
channel's open span. Either channel MAY issue a command, because the bracket is explicit. A start
word spoken inside an already open span SHALL be treated as part of the instruction, not as a
restart.

#### Scenario: Interleaved channels do not mix

- **WHEN** the `mic` channel opens a command and the `system` channel speaks before the `mic`
  channel says the end word
- **THEN** the command carries only the `mic` channel's words and names `mic` as its speaker

#### Scenario: A command from the system channel

- **WHEN** the `system` channel says a start word, an instruction, and an end word
- **THEN** a command attributed to `system` is produced

#### Scenario: A second opener inside an open span

- **WHEN** a span is open and the speaker says the start word again before the end word
- **THEN** the second start word is part of the extracted instruction

### Requirement: An unterminated command is abandoned out loud

An open span SHALL be abandoned when, on that channel's next piece of speech, its accumulated text
exceeds the length cap (`too-long`) or more than the time cap has passed since it opened
(`timeout`); an end word in that same piece SHALL close the command instead. When the capture
closes with a span still open, that span SHALL be abandoned with reason `timeout`. After an
abandonment the channel SHALL return to watching for a start word, so the speech that follows is
not treated as the instruction.

A command that quietly never happened is indistinguishable from one the microphone never heard,
and the operator would go and debug their audio chain; it is also what stops the next twenty
minutes of speech silently becoming "the instruction".

#### Scenario: The time cap abandons a span

- **WHEN** a span has been open longer than the time cap and the speaker says more without the
  end word
- **THEN** an abandonment with reason `timeout` is produced, carrying what had been said

#### Scenario: The length cap abandons a span

- **WHEN** an open span's text grows past the character cap without an end word
- **THEN** an abandonment with reason `too-long` is produced

#### Scenario: The capture ends mid-instruction

- **WHEN** the capture closes while a span is open
- **THEN** an abandonment with reason `timeout` is written before the capture exits

#### Scenario: Speech after an abandonment is not an instruction

- **WHEN** a span was abandoned and the speaker then says an end word
- **THEN** no command is produced

### Requirement: Fast-lane verdicts are written into the transcript stream

A completed command SHALL be appended to the transcript as
`{"type":"command","speaker":S,"text":T,"startTs":A,"ts":B,"urgency":"high"}`, and an abandonment
as `{"type":"command-abandoned","speaker":S,"partial":P,"reason":"timeout"|"too-long","startTs":A,"ts":B}`.
A command SHALL carry `"urgency":"high"` so a consumer that knows only the older vocabulary still
treats it as something to act on now. The words of the command SHALL also remain in the ordinary
transcript line that carried them: the transcript is a record of what was said, and editing it
would be a lie.

#### Scenario: A command event and its line

- **WHEN** the speaker completes a bracketed command
- **THEN** the transcript holds a `command` event with the extracted text and `"urgency":"high"`,
  and the ordinary speech line still contains the spoken words, markers included

### Requirement: The fast lane is configured under copilot.fastLane

The vocabulary and caps SHALL come from `copilot.fastLane`: `enabled` (on unless explicitly
`false`), `start` and `end` word lists, `maxSpanMs`, and `maxChars`. The defaults SHALL be start
words `copilot`, `start`; end words `csináld`, `stop`, `vége`; a 45 000 ms time cap; and a
600-character length cap. An absent, empty or malformed word list SHALL fall back to its default,
and a cap that is not a positive number SHALL fall back to its default. When the lane is
disabled, no fast-lane event SHALL be written.

#### Scenario: Defaults apply with no configuration

- **WHEN** no `copilot.fastLane` is configured
- **THEN** `copilot … csináld` and `start … stop` both bracket a command, and a span is abandoned
  after 45 s or 600 characters

#### Scenario: A disabled lane writes nothing

- **WHEN** `copilot.fastLane.enabled` is `false`
- **THEN** no `command` or `command-abandoned` event is ever written

#### Scenario: A bad cap falls back

- **WHEN** `copilot.fastLane.maxSpanMs` is `0` or a string
- **THEN** the 45 000 ms default is used

### Requirement: A fast-lane event reaches the copilot at the next poll tick

A `command` or `command-abandoned` event SHALL end the poll's wait at its next tick, without
waiting for a silence or any other ambient trigger, and SHALL never be removed by the poll's echo
deduplication: an instruction repeated verbatim (because the first drew the wrong thing) is a
second instruction, not an echo.

#### Scenario: A command does not wait for the ambient gate

- **WHEN** a `command` event is appended during a poll's wait
- **THEN** the poll returns with it at its next tick

#### Scenario: A repeated command is delivered twice

- **WHEN** two identical `command` events are appended in one batch
- **THEN** the poll returns both

### Requirement: The copilot policy teaches the copilot to act on the event, not the line

When the lane is enabled, the policy printed by `set-copilot prompt` SHALL include a fast-lane
section that names the configured opening and closing words, shows the `command` and
`command-abandoned` event shapes, and instructs the copilot to: execute a `command` event as an
instruction ahead of everything else in its turn, including an alert, regardless of the
engagement rule; act on the event and never on the transcript line that also carries the words,
so one instruction is not carried out twice; and never execute a `command-abandoned` partial,
instead saying in one chat line that it heard the opening and is waiting for the closing word.
When the lane is disabled the section SHALL be absent.

#### Scenario: The policy names the configured words

- **WHEN** `set-copilot prompt` runs with the default fast lane
- **THEN** the output contains the fast-lane section listing `copilot, start` as opening words and
  `csináld, stop, vége` as closing words

#### Scenario: No section when disabled

- **WHEN** `set-copilot prompt` runs with `copilot.fastLane.enabled` set to `false`
- **THEN** the output contains no fast-lane section
