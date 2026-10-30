# speech-to-text-backends Specification

## Purpose

Turn each captured audio channel into a stream of transcript tokens through one of
interchangeable speech-to-text backends — Soniox real-time, Soniox chunked, or local
whisper.cpp — and keep a long meeting transcribing through dropped connections without losing
speech, without inventing a second stream, and without breaking the channel's timeline.

## Requirements

### Requirement: The backend is selected by configuration and every backend emits the same events

The system SHALL select the speech-to-text backend from `sttBackend` (environment
`STT_BACKEND` wins): `"whisper"` selects local whisper.cpp, and any other value — including
none — selects Soniox. For Soniox, `sonioxMode` (environment `SONIOX_MODE` wins) SHALL select
`"chunk"` for the chunked fallback and anything else for real-time streaming. Each captured
channel SHALL get its own backend stream, and every backend SHALL deliver transcript events of
the same shape — channel (`mic` | `system`), text, whether final, and a time on the channel's
timeline — so the transcript writer and everything downstream are backend-agnostic. The
configured `language` (environment `SET_COPILOT_LANGUAGE` wins; default `en`) SHALL be passed to
the backend as its language hint.

#### Scenario: Unknown backend value falls back to Soniox real-time

- **WHEN** `sttBackend` is `"foo"` and `sonioxMode` is unset
- **THEN** capture uses Soniox real-time streaming

#### Scenario: Whisper selected from the environment

- **WHEN** the project config sets `sttBackend: "soniox"` and the environment sets
  `STT_BACKEND=whisper`
- **THEN** capture transcribes with local whisper.cpp

### Requirement: The Soniox key comes only from the environment, and a backend without its prerequisite refuses to start

The Soniox API key SHALL be the resolved `SONIOX_API_KEY` (environment or `.env` only — never a
configuration file, which may be committed; the resolution itself is specified by the
configuration capability). Before claiming the runtime dir or opening any audio device,
capture SHALL exit with status 1 when the selected backend's prerequisite is missing: for
Soniox, a message that `SONIOX_API_KEY` is required and where to set it; for whisper, a message
naming the missing model path, suggesting a model to download and pointing to
`set-copilot doctor`.

#### Scenario: A key in the config file is ignored

- **WHEN** a config file contains a `sonioxApiKey` value and no `SONIOX_API_KEY` is set in the
  environment or any `.env`
- **THEN** capture with the Soniox backend exits 1 stating that `SONIOX_API_KEY` is required

#### Scenario: Whisper model missing

- **WHEN** the whisper backend is selected and the configured model file does not exist
- **THEN** capture exits 1 naming the model path and pointing to `set-copilot doctor`, and no
  audio process is started

### Requirement: Real-time streaming sends raw PCM to Soniox's real-time model

In real-time mode each channel SHALL open a WebSocket to Soniox, send a configuration naming
the real-time model (`stt-rt-v5`), the language hint, the sample rate, `s16le` and one channel,
and then stream the channel's raw audio, emitting each received token — partial or final — as a
transcript event. A server error message SHALL be emitted as an error, not as text.

#### Scenario: Tokens arrive as events

- **WHEN** the server sends a message with three tokens, one of them final
- **THEN** three transcript events are emitted for that channel, with only that one marked
  final

### Requirement: A dropped real-time connection reconnects with backoff

When a real-time socket closes without the capture having begun its shutdown, the system SHALL
reconnect after a backoff of 0.5 s, 1 s, 2 s, 4 s, and then 8 s for every further attempt,
SHALL reset the backoff after a successful reconnect, and SHALL log each attempt with its
number and reason. Before this, a dropped socket was only logged: the capture stayed "running",
the byte counters kept climbing, every audio chunk was silently discarded, and no transcript
line ever appeared again — in a two-hour meeting, repeatedly. A single close SHALL never cost
the rest of the meeting.

#### Scenario: Backoff sequence

- **WHEN** a channel's socket drops and the next six connection attempts each close without
  ever opening
- **THEN** the seven attempts are scheduled 0.5 s, 1 s, 2 s, 4 s, 8 s, 8 s and 8 s after the
  respective close

#### Scenario: No reconnect during shutdown

- **WHEN** the socket closes after the capture began finalizing
- **THEN** no reconnect is scheduled and the close is reported as final

### Requirement: Audio spoken during an outage is buffered and replayed

While a real-time socket is down, the system SHALL keep the channel's incoming audio in a
bounded buffer of about 15 seconds, dropping the oldest audio first once full, and SHALL send it
as the head of the new stream when the socket reopens, so words spoken during the gap are
transcribed instead of lost. Audio still buffered when finalize begins on an open socket SHALL
be sent before the end-of-stream signal.

#### Scenario: Speech during a short drop is transcribed

- **WHEN** the socket is down for 3 seconds while the operator speaks, then reconnects
- **THEN** the 3 seconds of audio are sent first on the new socket and their words appear in
  the transcript

#### Scenario: A long outage keeps the most recent audio

- **WHEN** the socket is down for 40 seconds
- **THEN** only about the last 15 seconds of audio are replayed

### Requirement: A half-open socket is detected and replaced

The system SHALL ping each open real-time socket every 20 seconds and, if no pong arrives
within 15 seconds, SHALL terminate the socket and reconnect. A half-open socket reports itself
open forever and never fires a close event, so the close handler alone cannot see it; this was
the case that made a capture go deaf with no error.

#### Scenario: Silent dead socket

- **WHEN** a socket stays nominally open but stops answering pings
- **THEN** within 35 seconds it is terminated and a reconnect is scheduled with a reason
  stating no pong was received

### Requirement: A reconnect gap is recorded in the transcript

On every successful reconnect the capture SHALL write a `{"type":"reconnect"}` event line into
the transcript (its line format is owned by the live transcript format capability) carrying the channel (`speaker`), the downtime in milliseconds (`downtime_ms`)
and the duration of audio replayed from the buffer (`replayed_audio_ms`), and SHALL log the
downtime and replayed duration. A transcript that looks unbroken over a silent hole is
dishonest; the reader must be able to see "something may be missing here".

#### Scenario: Gap marker after a drop

- **WHEN** the `system` channel's socket drops and reconnects 2.5 seconds later with 2 seconds
  of buffered audio
- **THEN** the transcript gains a line with `type` `reconnect`, `speaker` `system`,
  `downtime_ms` about 2500 and `replayed_audio_ms` about 2000

### Requirement: A superseded socket is fenced off

When a channel opens a new real-time socket, the socket it replaces SHALL be discarded — its
listeners removed and the connection terminated — and any message or close that still arrives
from it SHALL be ignored: its tokens SHALL NOT be emitted and its close SHALL NOT schedule a
reconnect. A replaced socket's late close once scheduled a second reconnect while the new socket
was live, and two streams then fed one channel, the old one's tokens on the old clock.

#### Scenario: Late close of a replaced socket

- **WHEN** a channel has reconnected and the previous socket's close event arrives afterwards
- **THEN** no further reconnect is scheduled and only one socket is open for the channel

#### Scenario: Late tokens of a replaced socket

- **WHEN** a token message arrives on a socket that has already been replaced
- **THEN** no transcript event is emitted for it

### Requirement: Each channel keeps one timeline across reconnects

Every real-time token's time SHALL be placed on its channel's timeline, measured from the
channel's first connect: the time the current stream's audio begins (the moment the socket
opened, minus the duration of the replayed buffer) plus the token's offset within the stream.
A token time SHALL never be later than the current elapsed time, and a token without an offset
SHALL be stamped with the current elapsed time. Soniox times tokens from the start of its own
stream, so without this every reconnect restarted the clock at zero — measured on a two-hour
call: 37 restarts, and a transcript that could not be put back in order from its timestamps.

#### Scenario: Tokens after a reconnect continue the timeline

- **WHEN** a channel reconnects 600 seconds into the capture with no buffered audio and the new
  stream's first token has offset 1 000 ms
- **THEN** that token's time is about 601 000 ms, not 1 000 ms

#### Scenario: No token in the future

- **WHEN** a token's computed time would exceed the elapsed time since the channel's first
  connect
- **THEN** it is stamped with the elapsed time instead

### Requirement: Finalize waits for the transcription tail

When the capture finalizes a real-time stream, the system SHALL stop reconnecting and
heartbeating, signal end-of-stream to Soniox, and wait until Soniox reports it has finished (or
the socket closes), bounded by 6 seconds so a dead socket cannot hang shutdown. Soniox holds the
most recent audio as non-final tokens and only finalizes them once it knows no more audio is
coming; closing straight away dropped exactly that tail, and the more abruptly a dictation was
stopped the more it lost. The chunked and whisper backends SHALL, on finalize, transcribe the
audio still buffered and wait for its result, bounded by 20 seconds — closing without waiting
dropped up to a whole chunk interval of speech.

#### Scenario: Real-time tail delivered

- **WHEN** the capture is stopped while Soniox still holds non-final tokens for the last words
- **THEN** those words are emitted as final events before finalize returns

#### Scenario: Dead socket does not hang shutdown

- **WHEN** finalize sends end-of-stream on a socket that never answers
- **THEN** finalize returns after at most 6 seconds

### Requirement: The chunked Soniox fallback transcribes fixed intervals asynchronously

In chunked mode the system SHALL buffer each channel's audio and every 10 seconds upload the
buffered audio as a WAV file to Soniox's asynchronous API (model `stt-async-v4`, with the
language hint), poll for completion every 2 seconds for up to 60 polls, and emit the chunk's
whole text as one final transcript event. A chunk with no text SHALL emit nothing; an upload,
creation, transcription or timeout failure SHALL be emitted as an error for that chunk and SHALL
NOT stop the capture.

#### Scenario: One event per chunk

- **WHEN** a 10-second interval of speech completes transcription
- **THEN** exactly one final transcript event carrying the whole chunk's text is emitted for
  that channel

#### Scenario: A failing chunk does not end the capture

- **WHEN** the upload of one chunk fails
- **THEN** an error is reported for that chunk and the next interval is still transcribed

### Requirement: The whisper backend transcribes locally with no network and no key

The whisper backend SHALL buffer each channel's audio and every 10 seconds write it to a
temporary WAV file unique to the process, channel and chunk, run the configured whisper.cpp
binary (`whisper.bin`, environment `WHISPER_BIN`; default `whisper-cli`) on it with the
configured model (`whisper.model`, environment `WHISPER_MODEL`; default
`models/ggml-small.en.bin` under the user config directory) and the language, with timestamps
and progress output disabled, delete the temporary file, and emit the cleaned text as one final
transcript event. Output lines that consist entirely of a bracketed, parenthesized or starred
non-speech marker (such as `[BLANK_AUDIO]`) SHALL be dropped so silence does not reach the
transcript; brackets inside real speech SHALL be kept. A non-zero exit SHALL be reported as an
error carrying the last line of whisper's stderr. The whisper backend has no connection and SHALL
never emit a reconnect.

#### Scenario: Silent chunk produces nothing

- **WHEN** whisper's output for a chunk is only `[BLANK_AUDIO]`
- **THEN** no transcript event is emitted for that chunk

#### Scenario: Speech beside a marker is kept

- **WHEN** whisper's output is a `[BLANK_AUDIO]` line followed by a line of speech
- **THEN** one final transcript event carries the speech text only

#### Scenario: Temporary audio does not accumulate

- **WHEN** a chunk has been transcribed, successfully or not
- **THEN** its temporary WAV file no longer exists
