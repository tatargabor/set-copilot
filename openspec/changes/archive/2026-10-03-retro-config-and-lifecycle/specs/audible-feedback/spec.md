## Purpose

Tell the operator by ear, without looking at a screen, that dictation or a meeting capture has
actually started or stopped — and raise a desktop notification when a skill needs attention — with
sounds that ship as code rather than binary assets, can be replaced by the operator's own, and
never delay the command that plays them.

## ADDED Requirements

### Requirement: Start and stop tones are directional

The system SHALL play a start tone that rises (G5 → C6) and a stop tone that falls (C6 → G5), so
the direction alone says which way the session went. Each tone SHALL be a two-note bell motif —
harmonic partials with exponential decay, about 0.7 seconds in all — synthesized by the package
itself; no audio asset ships in the package. A raw sine sweep, the first version, sounded like a
test signal rather than a product notification.

#### Scenario: Start rises, stop falls

- **WHEN** the start tone and then the stop tone are played with no custom sounds configured
- **THEN** the start tone's second note is higher than its first, and the stop tone's is lower

### Requirement: Synthesized tones are cached per synthesis version

A synthesized tone SHALL be generated on first use and cached as a WAV file in the operating
system's temporary directory, under a file name that carries the synthesis version, so a later run
reuses it and a change to the synthesis is never masked by a stale cached file.

#### Scenario: The cache is reused

- **WHEN** a tone is played a second time
- **THEN** the cached file from the first play is used rather than synthesized again

#### Scenario: A synthesis change invalidates the cache

- **WHEN** the synthesis version changes
- **THEN** the tone is synthesized afresh under the new version's file name

### Requirement: A configured custom sound wins when the file exists

`audio.toneStart` and `audio.toneEnd` SHALL name sound files that replace the built-in start and
stop tones everywhere a tone is played. A configured path whose file does not exist SHALL fall back
to the built-in tone rather than play nothing.

#### Scenario: A custom start sound

- **WHEN** `audio.toneStart` names an existing sound file and the start tone is played
- **THEN** that file is played instead of the built-in tone

#### Scenario: A missing custom file falls back

- **WHEN** `audio.toneEnd` names a file that does not exist and the stop tone is played
- **THEN** the built-in stop tone is played

### Requirement: Playback never blocks the caller

A tone SHALL be played fire-and-forget, in a detached player process (`paplay` on Linux, `afplay`
on macOS), and the calling command SHALL NOT wait for it to finish. An earlier stop path played its
chime before killing the capture and blocked for about 2.7 seconds. On any other platform the
system SHALL write the terminal bell instead — once for start, twice for stop.

#### Scenario: Stop does not wait for its chime

- **WHEN** `stop` plays the stop tone
- **THEN** the command proceeds to the hand-over without waiting for playback to end

#### Scenario: An unsupported platform rings the terminal bell

- **WHEN** a tone is played on a platform other than Linux or macOS
- **THEN** the terminal bell is written instead of starting a player

### Requirement: The tones mark what actually happened

A capture SHALL play the start tone itself when its microphone transcription connection is live —
the moment speech will actually be recorded — rather than leave it to the caller, whose turn may
arrive before or after that moment. `stop` SHALL play the stop tone when it found a capture PID file
to act on, and SHALL stay silent when there is no capture PID file: `stop` runs at every session end
(including `/clear`), and a stop that stopped nothing must not chime.

#### Scenario: The start tone follows the live microphone

- **WHEN** a capture starts and its microphone transcription connection opens
- **THEN** the start tone is played at that moment

#### Scenario: A stop with nothing to stop is silent

- **WHEN** `stop` runs in a runtime dir with no `capture.pid`
- **THEN** no tone is played

### Requirement: beep and notify expose the feedback to skills

`beep` SHALL play the start tone, and `beep --end` the stop tone, honouring the configured custom
sounds.
`notify <title> [body]` SHALL raise a desktop notification — `notify-send` with a 30-second
display time on Linux, an AppleScript notification on macOS — and `--critical` SHALL additionally
mark it critical on Linux and play the platform's warning sound.

#### Scenario: beep --end plays the stop tone

- **WHEN** `beep --end` runs with no custom sounds configured
- **THEN** the built-in falling stop tone is played

#### Scenario: A critical notification is louder

- **WHEN** `notify "Alert" "body" --critical` runs on Linux
- **THEN** a critical-urgency notification is shown and the warning sound is played
