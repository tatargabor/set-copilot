# Proposal

## Why

The capture pipeline — audio in, speech-to-text out, and the health check that proves the
chain works — is the oldest and most field-hardened part of set-copilot, and none of it has
an OpenSpec spec. Its behaviour was shipped in ad hoc fixes, each forced by a real failure
(a silent 0-byte capture, a deaf socket, a lost dictation tail, a clock reset on every
reconnect), so today the code is the only source of truth. This is a **retro-spec**: it
writes down what the code already does, so the next change to this path can be proposed
against a spec instead of rediscovered from `git log`.

## What Changes

- Specs only. **No source code changes.** Every requirement describes behaviour verified
  against the current code; nothing is aspirational.
- Introduces three capability specs covering the capture pipeline, each requirement
  carrying the field failure that made the behaviour necessary, as the existing specs do.
- Behaviour already specified elsewhere is referenced, not restated: config-drift and
  mirror-readiness reporting stay in `setup-diagnostics`; runtime-dir ownership and the
  transcript handover stay with the runtime-dir and transcript capabilities; the transcript
  line format stays with the writer.

## Capabilities

### New Capabilities

- `audio-capture`: the two-channel audio capture (`capture`, `sources`) — platform audio
  binaries and their resolution, device defaults, mic-only dictation mode, surfacing of
  audio-process failures, the zero-byte / low-signal / no-token watchdogs, the empty-
  transcript diagnosis at stop, the start-up input-gain check, the ordered shutdown, the
  `--max-minutes` self-stop and the start tone.
- `speech-to-text-backends`: the interchangeable speech-to-text backends (Soniox real-time,
  Soniox chunked, local whisper.cpp) — selection, credential sourcing and the refusal to
  start without them, real-time reconnect with buffered replay, half-open detection,
  superseded-socket fencing, one timeline per channel across reconnects, the recorded
  reconnect gap, and the tail-preserving finalize.
- `audio-health-check`: the audio half of `doctor` — backend prerequisites, audio-binary
  resolution without crashing, the real-signal probe with retry, the macOS microphone-
  permission diagnosis that names the enclosing app, and an exit code that means exactly
  "this machine cannot record".

### Modified Capabilities

(none)

## Impact

- New files only: `openspec/specs/audio-capture/spec.md`,
  `openspec/specs/speech-to-text-backends/spec.md`, `openspec/specs/audio-health-check/spec.md`
  (after archive).
- Code described (not changed): `src/capture.ts`, `src/audio.ts`, `src/soniox-rt.ts`,
  `src/whisper-local.ts`, `src/doctor.ts` (audio half), `src/tones.ts`, the `capture` /
  `sources` / `doctor` cases in `src/cli.ts`, and the backend/credential keys in
  `src/config.ts`.
