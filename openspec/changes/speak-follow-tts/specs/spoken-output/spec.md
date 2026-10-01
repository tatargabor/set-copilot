## ADDED Requirements

### Requirement: Speech is delivered by a follower, never by a turn-boundary hook

The system SHALL speak the session's assistant messages from a process that follows the session
transcript continuously, delivering each text block at the moment it is written. It SHALL NOT
deliver speech from a `Stop` hook or any other turn-boundary trigger.

The reason is measured, not aesthetic: the chat→wall mirror's `Stop` hook was permanently one
message behind — it fired at turn end, raced the final block's flush to disk, and kept only the
turn's last block, so everything said mid-turn was discarded and a session's closing summary could
never be delivered at all. Mirrored, that is a lost line. Spoken, it means the operator hears the
*previous* answer while reading the current one, which makes the channel actively misleading.

Sidechain (subagent) transcript entries SHALL be excluded: they share the file, and speaking every
subagent's chatter would bury the session's own voice.

#### Scenario: A message is spoken as it is written, mid-turn

- **WHEN** an assistant text block is appended to the session transcript while the turn is still
  running
- **THEN** the follower SHALL speak it without waiting for the turn to end

#### Scenario: A turn's closing message is spoken

- **WHEN** the final assistant text block of a turn is written
- **THEN** the follower SHALL speak it — there is no turn-boundary race that can drop it

#### Scenario: Subagent output is not spoken

- **WHEN** a transcript entry is marked as a sidechain entry
- **THEN** the follower SHALL skip it and speak nothing for it

### Requirement: The follower owns the runtime dir's speech state

The follower SHALL own `speak.pid`, `speak-offset`, `speak.log` and `speak.enabled` in the runtime
dir, under the same ownership rules the capture and the mirror follow: a second follower SHALL be
refused while one is live, a stale PID file SHALL be reclaimed, `stop` SHALL stop it, and
`set-repair` SHALL report an orphaned `speak.pid`.

The read offset SHALL advance only AFTER an utterance has been handed to the engine successfully.
A failed pass SHALL leave the offset untouched so the next pass retries. Stamping before delivering
is what made the mirror hook's failures both invisible and unretryable, and this path SHALL NOT
repeat it.

Where no offset has been recorded yet, or where the transcript is shorter than the recorded offset
(truncated, rotated, replaced), the follower SHALL resume at end-of-file and record the
discontinuity, rather than speaking a session's accumulated history aloud.

#### Scenario: A second follower is refused

- **WHEN** `speak-follow` is started in a runtime dir whose `speak.pid` names a live process
- **THEN** it SHALL refuse to start, leaving the running follower's PID file intact

#### Scenario: A stale PID is reclaimed

- **WHEN** `speak-follow` is started in a runtime dir whose `speak.pid` names a process that is gone
- **THEN** it SHALL take ownership and start

#### Scenario: A failed utterance is retried, not skipped

- **WHEN** the engine fails to speak a message
- **THEN** the offset SHALL NOT advance, the failure SHALL be recorded, and the next pass SHALL
  re-read and retry that message

#### Scenario: Enabling speech mid-session does not replay history

- **WHEN** the follower starts in a runtime dir that has no recorded offset and a transcript that
  already holds a long session
- **THEN** it SHALL resume at end-of-file and speak nothing that was written before it started

### Requirement: Speech is opt-in and toggleable at runtime

Speech SHALL be off by default. The system SHALL provide `set-copilot speak on` and
`set-copilot speak off`, which create and remove a `speak.enabled` marker in the runtime dir.

The follower SHALL re-evaluate the marker on every pass, not once at startup, so speech can be
switched on and off mid-session without restarting the follower or the session. While the marker is
absent, the follower SHALL advance its offset past the messages it declines to speak rather than
queueing them, so switching speech on does not release a backlog.

#### Scenario: Off by default

- **WHEN** a follower runs in a runtime dir with no `speak.enabled` marker
- **THEN** nothing SHALL be spoken

#### Scenario: Switched on mid-session

- **WHEN** `set-copilot speak on` is run while a follower is already running
- **THEN** the next message written SHALL be spoken, with no restart required

#### Scenario: Switching on does not release a backlog

- **WHEN** several messages are written while speech is off, and speech is then switched on
- **THEN** only messages written after the switch SHALL be spoken

### Requirement: What is spoken is selected without a second model call

The system SHALL derive the spoken text from the message that was already generated, and SHALL NOT
make any additional model call on the speech path. Latency parity with the terminal is a hard
requirement: the spoken channel exists to be heard while the answer is still current.

Selection SHALL be two-tier:

1. Where the message carries a model-written spoken lead — one short line the same generation
   produced, identified by a configured marker — that lead SHALL be what is spoken.
2. Otherwise the system SHALL derive the spoken text mechanically and deterministically: leading
   sentences up to the configured character ceiling, with fenced code blocks, tables, file paths
   and URLs removed.

The mechanical extractor SHALL be a pure function, unit-tested independently of any audio path.

#### Scenario: A marked spoken lead is what is spoken

- **WHEN** a message begins with the configured spoken-lead marker followed by a short line
- **THEN** that line SHALL be spoken, and the rest of the message SHALL NOT be

#### Scenario: An unmarked message is reduced mechanically

- **WHEN** a message carries no spoken lead
- **THEN** the system SHALL speak leading sentences up to the character ceiling, having removed code
  blocks, tables, paths and URLs — with no model call

#### Scenario: A message with nothing speakable is skipped

- **WHEN** a message reduces to empty after extraction (it was only a code block, only a path, or
  below the length floor)
- **THEN** nothing SHALL be spoken and the decision SHALL be recorded

### Requirement: Length is a ceiling, not a division

Spoken output SHALL be truncated at the configured ceiling. It SHALL NOT be divided into
consecutive utterances the way a mirrored message is divided into consecutive wall events.

The two channels differ in what a listener does with the remainder: a wall box accumulates chunks
and the reader scans them, whereas a listener does not wait through the second chunk of a nine-item
report. The remainder stays in the terminal, which is and remains the detailed channel.

Truncation SHALL fall on a sentence boundary where one exists within the ceiling, so the utterance
does not end mid-clause.

#### Scenario: A long message is truncated, not queued as several utterances

- **WHEN** a message's spoken text exceeds the ceiling
- **THEN** exactly one utterance SHALL be spoken, ending at the last sentence boundary within the
  ceiling, and no continuation utterance SHALL follow

### Requirement: Speech is suppressed while a capture owns the runtime dir

While a live capture owns the runtime dir (its `capture.pid` names a running process), the follower
SHALL NOT speak.

A microphone capture records the room, and the room includes the machine's own speakers. Without
this rule the spoken answer is transcribed by the very capture that is listening, and the session
receives its own words back as user input. This is a required behavior, not a configurable one.

Messages arriving during suppression SHALL be handled as the gate handles them elsewhere: the
offset advances and the decision is recorded, so speech does not burst out when the capture ends.

#### Scenario: Nothing is spoken while dictation is recording

- **WHEN** a message is written while a capture is live in the same runtime dir
- **THEN** nothing SHALL be spoken, and the suppression SHALL be recorded

#### Scenario: Suppressed messages do not burst afterwards

- **WHEN** a capture ends after several messages were suppressed
- **THEN** those messages SHALL NOT be spoken retroactively; only messages written after the capture
  ended SHALL be spoken

### Requirement: A new message interrupts the utterance in progress

Where a new message becomes speakable while an utterance is still being spoken, the system SHALL
stop the utterance in progress and speak the new one. It SHALL NOT queue utterances behind one
another.

An answer that has been superseded is not worth the listener's time, and a queue makes the spoken
channel drift further behind the terminal with every message — the failure mode this capability
exists to avoid.

#### Scenario: The newer answer wins

- **WHEN** a message becomes speakable while the previous utterance is still being spoken
- **THEN** the previous utterance SHALL be stopped and the new one spoken immediately

### Requirement: The speech engine is a configured seam with a cloud primary and a local fallback

The engine SHALL be selected by configuration (`speech.engine`), with voice, rate, language and the
character ceiling configured alongside it. Engine choice, voice and language are project and machine
facts, so they belong in config rather than in the engine's source.

This change SHALL ship two implementations:

1. **A cloud engine (default)** — a network speech synthesis service, because synthesis quality is
   the deciding factor for the channel's usefulness and the local voice was judged inadequate for
   the operator's language in a listening test. Its credentials SHALL be read from the environment
   or a `.env` file only, NEVER from committed configuration — the rule the transcription API key
   already follows.
2. **A local engine (fallback)** — the platform's offline speech command, which needs no
   credentials and no network.

Where the cloud engine is unavailable for any reason — no credential, no network, an API error, or a
synthesis slower than the configured deadline — the system SHALL fall back to the local engine for
that utterance and record which engine spoke. Speech SHALL NOT be dropped merely because the
preferred engine failed; a lower-quality utterance carries the information, and silence does not.

Where no engine at all is available, the system SHALL report that plainly — at `speak on` and in
`doctor` — rather than leaving the operator with a follower that speaks nothing for no stated reason.

#### Scenario: The cloud engine is used when it is configured and reachable

- **WHEN** speech is enabled with a credential present and the cloud engine reachable
- **THEN** the utterance SHALL be synthesized by the cloud engine in the configured voice and
  language

#### Scenario: A cloud failure falls back rather than going silent

- **WHEN** the cloud engine returns an error, has no credential, or exceeds the synthesis deadline
- **THEN** the utterance SHALL be spoken by the local engine instead, and the log SHALL record both
  the fallback and its cause

#### Scenario: The credential never comes from committed configuration

- **WHEN** the cloud engine resolves its credential
- **THEN** it SHALL read it only from the environment or a `.env` file, and a credential placed in a
  committed config file SHALL NOT be used

#### Scenario: An unavailable engine is reported, not silent

- **WHEN** speech is enabled and neither engine can be resolved
- **THEN** `speak on` SHALL report it and `doctor` SHALL report it, rather than leaving the operator
  with a follower that speaks nothing for no stated reason

### Requirement: The operator is told that spoken text leaves the machine

Where a cloud engine is the active engine, the system SHALL make that fact visible rather than
implicit: `speak on` SHALL name the active engine, and `doctor` SHALL report which engine is active
and whether it is local or remote.

Speech synthesized in the cloud means the copilot's answers — which may quote client material, code,
or credentials-adjacent detail from the session — are transmitted to a third party. That is a
legitimate operator choice, but it SHALL be a made choice and not a surprise, and the local engine
SHALL remain selectable as a complete alternative for sessions where it is not acceptable.

#### Scenario: The active engine is named when speech is switched on

- **WHEN** `set-copilot speak on` succeeds with a cloud engine active
- **THEN** it SHALL name the engine and state that spoken text is sent to it

#### Scenario: A fully local configuration is available

- **WHEN** the operator configures the local engine
- **THEN** no spoken text SHALL leave the machine, and no credential SHALL be required

### Requirement: Every speech decision is recorded and inspectable

The follower SHALL append one record per considered message to `speak.log`, naming the decision:
spoken, skipped as unspeakable, suppressed by a live capture, gated off, interrupted, duplicate, or
failed. The log SHALL be rotated rather than truncated when it exceeds its line budget.

`doctor` SHALL answer, for speech: whether a follower is alive, whether the marker is present,
whether an engine is available, and when speech was last delivered.

The mirror's field failure was undiagnosable precisely because nothing on disk distinguished "never
ran" from "decided not to". Speech is harder to diagnose than the wall — silence looks identical
whatever caused it — so this requirement is stricter here, not weaker.

#### Scenario: A silent follower can be diagnosed

- **WHEN** the operator hears nothing and runs `doctor`
- **THEN** it SHALL report follower liveness, marker presence, engine availability and the last
  delivery time, so the cause is named rather than guessed

#### Scenario: Each suppressed message is attributable

- **WHEN** a message is not spoken
- **THEN** `speak.log` SHALL record which rule suppressed it — the gate, a live capture, the length
  floor, extraction yielding nothing, or an engine failure
