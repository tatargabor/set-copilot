# Design

## Context

This is a retro-spec (see proposal.md — Why). The code in `src/capture.ts`, `src/audio.ts`,
`src/soniox-rt.ts`, `src/whisper-local.ts` and the audio half of `src/doctor.ts` is the source of
truth; the only design question is **where to draw the line** between behaviour worth a
normative requirement and implementation that is free to change.

## Goals / Non-Goals

**Goals:**
- Specify every behaviour an operator or a downstream reader can observe and has relied on —
  above all the diagnostics, because each one exists because its absence produced a silent
  empty transcript in the field.
- Carry the measured "why" into the requirement text, so a later change cannot remove a
  defence without first reading what it defended against.

**Non-Goals:**
- No behaviour change, and no requirement for behaviour the code does not have.
- Not restating what other capabilities own: config drift and mirror readiness
  (`setup-diagnostics`), runtime-dir ownership and the exactly-once handover (runtime-dir /
  transcript capabilities), the transcript line format and flush rules (the writer), the
  `--detach` relaunch (process lifecycle), and the config-file merge rules for `audio`, the
  `MIC_SOURCE=` empty-override and `SONIOX_API_KEY` resolution rules, and the
  device-in-project-config migration (configuration). The reconnect line's format belongs to
  the live transcript format; this change specifies only when the capture writes it.

## Decisions

**Specified deliberately (observable contract):**
- The five capture diagnostics (5 s zero-byte, per-minute level line, 30 s deaf watchdog with
  two distinct messages, stop-time `EMPTY TRANSCRIPT`, start-up gain check) including their
  thresholds and timings. The thresholds (rms 300, gain 75 %) are measured values that the
  messages quote, so they are part of what the operator reads.
- Binary resolution order (`/usr/bin/parec`; Homebrew sox paths before `PATH`), and the device
  defaults (what an empty device records) — each was the root cause of a 0-byte capture.
- Reconnect backoff schedule, ~15 s replay buffer, 20 s/15 s heartbeat, superseded-socket
  fencing, the per-channel timeline and the `{"type":"reconnect"}` line with its three fields —
  the transcript reader and the stitch depend on the last two.
- Finalize bounds (6 s real-time, 20 s chunked/whisper) and the shutdown order.
- `doctor`'s exit-status meaning, because skills gate on it.

**Left as implementation detail (not specified):**
- Class and function names, the event-emitter shape, and the exact console wording
  (`doctor`'s output is Hungarian product copy; requirements describe its content, not its
  strings).
- The live `[mic]` / `[sys]` echo of final tokens to stdout, the WAV header layout, the
  multipart upload format, and the temp-file naming scheme beyond "unique per process, channel
  and chunk".
- Soniox's legacy whole-`text` message path, which no current model emits.
- The chunk client's constructor default of 30 s: capture always wires 10 s, and 10 s is what
  is specified.

**Corrections to the starting census (the code wins):**
- The gain check runs only when `micSource` names a device (without one there is no reliable
  "the source being recorded" in `pactl` output).
- `sources` is default-first and inputs-only on **macOS** only; on Linux it prints the raw
  `pactl list sources short` lines, monitors included, unordered.
- The `EMPTY TRANSCRIPT` diagnosis is one of three mutually exclusive messages chosen by the
  evidence, not one message listing three causes.
- `doctor` probes the system monitor on Linux only; on macOS the loopback device is not probed.
- The whisper language is the configured `language` (default `en`), not `auto`; `auto` is only
  the fallback for an empty value.
- The start tone fires on the mic stream's first "connected" — for real-time that is the
  socket opening; for chunked/whisper it is at start, before any audio is transcribed.
- The deaf watchdog warns at most once per capture and checks the microphone only.

## Risks / Trade-offs

- [Timings and thresholds are now normative] → a tuning change needs a spec delta. Accepted:
  every one of them was measured, and a silent retune is exactly how a defence erodes.
- [Retro-specs can encode an accident as intent] → each requirement was checked against the
  commit that introduced it; behaviour with no evident purpose was left unspecified rather than
  frozen.
