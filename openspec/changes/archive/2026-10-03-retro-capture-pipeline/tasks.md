# Tasks

Retro-spec: every task verifies that a requirement describes what the code already does. No
code changes.

## 1. audio-capture

- [x] 1.1 Verify two-channel capture, `--mic-only` / `MIC_ONLY=1` dictation mode, `--output` and the unsupported-platform refusal against src/audio.ts:27 and src/capture.ts:134 [REQ: Capture records two independent channels, or the mic alone in dictation mode]
- [x] 1.2 Verify the device defaults (`@DEFAULT_MONITOR@`, `BlackHole 2ch`) and the set-but-empty env override against src/audio.ts:161, src/audio.ts:188 and src/config.ts:1149 [REQ: An unconfigured device records the platform default]
- [x] 1.3 Verify parec/sox resolution order against src/audio.ts:46 and src/audio.ts:57 [REQ: Audio binaries resolve to the known-good install before PATH]
- [x] 1.4 Verify stderr, non-SIGTERM exit and spawn-error reporting against src/audio.ts:109 [REQ: Audio-process failures are surfaced, never swallowed]
- [x] 1.5 Verify the one-time mic-only hint for an unopenable macOS system device against src/audio.ts:176 and src/audio.ts:110 [REQ: A missing macOS system-audio device degrades to mic-only with a one-time hint]
- [x] 1.6 Verify the 5 s zero-byte warnings (mic always, system in meeting mode only) against src/capture.ts:259 [REQ: Zero audio bytes are reported after five seconds]
- [x] 1.7 Verify the per-minute KB/rms/peak/token line and per-window reset against src/capture.ts:268 [REQ: Signal level is logged every minute]
- [x] 1.8 Verify the 30 s deaf watchdog (threshold 300, two messages, at most one per capture, skipped at 0 bytes) against src/capture.ts:289 and the LevelMeter tests in src/capture-level.test.ts [REQ: A deaf capture is diagnosed after thirty seconds, naming which failure it is]
- [x] 1.9 Verify the three mutually exclusive `EMPTY TRANSCRIPT` diagnoses naming the device against src/capture.ts:325 [REQ: An empty transcript explains itself at stop]
- [x] 1.10 Verify the start-up gain check (muted, <75 %, silent without a named source) against src/capture.ts:365 and src/audio-gain.test.ts [REQ: A low or muted input gain is reported at start]
- [x] 1.11 Verify the shutdown order and re-entrance guard against src/capture.ts:308 [REQ: Shutdown stops audio first and waits for the transcription tail]
- [x] 1.12 Verify the `--max-minutes` self-stop through the same shutdown against src/capture.ts:351 and src/cli.ts:91 [REQ: `--max-minutes` stops the capture on its own]
- [x] 1.13 Verify the start tone on first `connected` only, custom `toneStart`, fire-and-forget playback against src/capture.ts:205 and src/tones.ts:27 [REQ: A start tone marks the moment speech is captured]
- [x] 1.14 Verify `sources` (Linux raw pactl lines; macOS system_profiler inputs-only, default first; empty list on missing binary) against src/audio.ts:301, src/audio.ts:263 and src/audio.test.ts [REQ: `sources` lists the audio inputs a device name can be copied from]

## 2. speech-to-text-backends

- [x] 2.1 Verify backend and mode selection, env precedence and the language hint against src/config.ts:1123 and src/capture.ts:170 [REQ: The backend is selected by configuration and every backend emits the same events]
- [x] 2.2 Verify the key comes only from env / project `.env` / user `.env` and the start-up refusal for a missing key or model against src/config.ts:409, src/config.ts:1130 and src/capture.ts:124 [REQ: The Soniox key comes only from the environment, and a backend without its prerequisite refuses to start]
- [x] 2.3 Verify the real-time session config (`stt-rt-v5`, s16le, mono) and token/error emission against src/soniox-rt.ts:108 and src/soniox-rt.ts:136 [REQ: Real-time streaming sends raw PCM to Soniox's real-time model]
- [x] 2.4 Verify the 0.5→8 s backoff, reset on open and no reconnect while closing against src/soniox-rt.ts:239 and src/soniox-rt.ts:179 [REQ: A dropped real-time connection reconnects with backoff]
- [x] 2.5 Verify the ~15 s oldest-first-dropped buffer and its replay on open and at finalize against src/soniox-rt.ts:261, src/soniox-rt.ts:251 and src/soniox-rt.ts:304 [REQ: Audio spoken during an outage is buffered and replayed]
- [x] 2.6 Verify the 20 s ping / 15 s pong heartbeat and forced terminate against src/soniox-rt.ts:212 [REQ: A half-open socket is detected and replaced]
- [x] 2.7 Verify the `{"type":"reconnect"}` line with `speaker`, `downtime_ms`, `replayed_audio_ms` against src/capture.ts:39 [REQ: A reconnect gap is recorded in the transcript]
- [x] 2.8 Verify superseded-socket fencing (terminate, ignore late messages and close) against src/soniox-rt.ts:98, src/soniox-rt.ts:137, src/soniox-rt.ts:180 and src/soniox-rt.test.ts [REQ: A superseded socket is fenced off]
- [x] 2.9 Verify the per-stream base, offset placement and never-after-now clamp against src/soniox-rt.ts:126, src/soniox-rt.ts:202 and src/soniox-rt.test.ts [REQ: Each channel keeps one timeline across reconnects]
- [x] 2.10 Verify the end-of-stream + `finished` wait bounded at 6 s, and the 20 s chunk/whisper finalize, against src/soniox-rt.ts:288, src/soniox-rt.ts:501 and src/whisper-local.ts:123 [REQ: Finalize waits for the transcription tail]
- [x] 2.11 Verify the chunked fallback (10 s as wired, `stt-async-v4`, 2 s × 60 polls, one event per chunk, non-fatal errors) against src/soniox-rt.ts:391, src/soniox-rt.ts:414 and src/capture.ts:186 [REQ: The chunked Soniox fallback transcribes fixed intervals asynchronously]
- [x] 2.12 Verify the whisper.cpp invocation, defaults, temp-file cleanup, marker filtering and error reporting against src/whisper-local.ts:86, src/whisper-local.ts:148, src/config.ts:1133 and src/whisper-local.test.ts [REQ: The whisper backend transcribes locally with no network and no key]

## 3. audio-health-check

- [x] 3.1 Verify the whisper binary/model and Soniox key checks against src/doctor.ts:319 [REQ: The health check verifies the selected backend's prerequisites]
- [x] 3.2 Verify binary resolution reporting, probe skip and crash-free source listing against src/doctor.ts:341 and src/audio.ts:310 [REQ: Audio binary resolution is reported and never crashes the check]
- [x] 3.3 Verify the source list and configured-device lines against src/doctor.ts:351 [REQ: The configured devices and available sources are shown]
- [x] 3.4 Verify the 3 s probe, one retry, 3 s kill / 5 s guard and the three-way verdict (mic on all platforms, monitor on Linux) against src/doctor.ts:33, src/doctor.ts:40, src/doctor.ts:109 and src/doctor.ts:360 [REQ: Each source is probed for real signal, with one retry]
- [x] 3.5 Verify the macOS permission diagnosis naming the nearest enclosing `.app` against src/doctor.ts:82, src/doctor.ts:91, src/doctor.ts:116 and src/doctor.test.ts [REQ: A macOS zero-byte probe names the app that holds the Microphone permission]
- [x] 3.6 Verify the exit status is set only by chain failures and the scoped summary against src/doctor.ts:374 and src/doctor.ts:384 [REQ: The exit status means exactly "this machine cannot record"]
