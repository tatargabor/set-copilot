# audio-capture Specification

## Purpose

Capture the operator's microphone and, in meeting mode, the system audio as two independent
16 kHz mono channels and feed them to speech-to-text — and, because every audio failure looks
the same from the outside (a capture that runs, errors nothing, and yields an empty
transcript), make each distinct cause say which one it is while it is happening and again at
stop.

## Requirements

### Requirement: Capture records two independent channels, or the mic alone in dictation mode

`set-copilot capture` SHALL record the microphone as the `mic` channel and, in meeting mode,
the system audio output as the `system` channel, each as raw signed 16-bit little-endian mono
PCM at the configured `audio.sampleRate` (default 16 000 Hz), and SHALL feed each channel to
its own speech-to-text stream. On Linux the audio SHALL be read with `parec`
(PulseAudio/PipeWire); on macOS with `sox` from CoreAudio. Any other platform SHALL be refused
with an error naming it.

`--mic-only` (or the environment variable `MIC_ONLY=1`) SHALL select dictation mode: only the
microphone is recorded, no system-audio process or speech-to-text stream is created, no
keyword index is loaded, and the output defaults to the dictation transcript path instead of
the meeting transcript path. `--output <path>` SHALL override the output path in either mode.

#### Scenario: Meeting mode records both channels

- **WHEN** `set-copilot capture` runs on Linux without `--mic-only`
- **THEN** two `parec` processes run, one for the microphone and one for the system monitor,
  and each feeds its own speech-to-text stream tagged `mic` and `system` respectively

#### Scenario: Dictation mode records the mic only

- **WHEN** `set-copilot capture --mic-only` runs
- **THEN** only one audio process runs, no `system` speech-to-text stream exists, and the
  transcript is written to the configured dictation output

#### Scenario: Unsupported platform

- **WHEN** capture starts on a platform other than Linux or macOS
- **THEN** it fails with an error naming the platform and stating that only linux and darwin
  are supported

### Requirement: An unconfigured device records the platform default

When `audio.micSource` is empty the microphone channel SHALL record the system default input.
When `audio.monitorSource` is empty the system channel SHALL record `@DEFAULT_MONITOR@` on
Linux and the virtual loopback device `BlackHole 2ch` on macOS. How `micSource` and
`monitorSource` resolve — including `MIC_SOURCE` / `MONITOR_SOURCE` set but empty meaning "no
device" — is specified by the configuration capability; this requirement covers what the
capture records once the value is resolved. An empty value matters because a device name is
hardware: a committed project config can pin one that does not exist on this machine, and the
default is the reliable escape from it.

#### Scenario: Empty environment override escapes a pinned device

- **WHEN** the project config sets `audio.micSource` to a device name and the environment sets
  `MIC_SOURCE=` (empty)
- **THEN** the capture records the system default input, not the configured device

#### Scenario: Default system channel on Linux

- **WHEN** a meeting capture starts on Linux with no `monitorSource` configured
- **THEN** the system channel records from `@DEFAULT_MONITOR@`

### Requirement: Audio binaries resolve to the known-good install before PATH

The capture SHALL resolve `parec` to `/usr/bin/parec` when that file exists, and only
otherwise to `parec` on `PATH`, because a `parec` from another package manager shadowing the
distro binary can hang silently against PipeWire — zero bytes forever, no error — which
presents as "connected but never transcribes". On macOS it SHALL resolve `sox` by probing
`/opt/homebrew/bin/sox`, then `/usr/local/bin/sox`, then `sox` on `PATH`, because a GUI- or
background-launched process frequently does not inherit the Homebrew bin directory, and a bare
spawn then fails with no audio and no obvious cause. The same resolution SHALL be used by
capture, source listing and the health check.

#### Scenario: Distro parec wins over a PATH shadow

- **WHEN** `/usr/bin/parec` exists and another `parec` precedes it on `PATH`
- **THEN** the capture spawns `/usr/bin/parec`

#### Scenario: Homebrew sox found without PATH

- **WHEN** on macOS `sox` is installed at `/opt/homebrew/bin/sox` and that directory is not on
  `PATH`
- **THEN** the capture still spawns sox from `/opt/homebrew/bin/sox` and audio flows

### Requirement: Audio-process failures are surfaced, never swallowed

Every audio process's stderr SHALL be printed, line by line, prefixed with its channel label.
An audio process that exits with a non-zero code for any reason other than the capture's own
`SIGTERM` SHALL be reported with its exit code and signal and the statement that no more audio
will come from that source; a process that cannot be spawned SHALL be reported with the spawn
error. Without this a failed audio process leaves the speech-to-text connection open over zero
audio and an empty transcript that cannot be diagnosed from the outside.

#### Scenario: An audio process dies mid-capture

- **WHEN** the microphone's audio process exits with a non-zero code while the capture is
  running
- **THEN** an error line names the `mic` channel, the exit code and signal, and states that no
  more audio will come from that source

#### Scenario: Intentional stop is not reported as a failure

- **WHEN** the capture stops its own audio processes with `SIGTERM` during shutdown
- **THEN** no exit failure is reported for them

### Requirement: A missing macOS system-audio device degrades to mic-only with a one-time hint

On macOS, when the system-audio device cannot be opened (its stderr reports that the device
cannot be opened or does not exist, its process exits with a failure, or it cannot be
spawned), the capture SHALL keep recording the microphone and SHALL print, at most once per
capture, a hint naming the device, stating that capture continues mic-only, and naming the two
fixes: install a loopback device and route output to it, or set `monitorSource`. A missing
loopback device is a setup gap, not a reason to lose the operator's own speech.

#### Scenario: BlackHole not installed

- **WHEN** a meeting capture starts on macOS with no `monitorSource` configured and no
  `BlackHole 2ch` device present
- **THEN** the microphone keeps transcribing, and exactly one hint line names `BlackHole 2ch`,
  says capture continues mic-only, and names both fixes, even if the failure is reported
  through more than one of stderr, exit and spawn error

### Requirement: Zero audio bytes are reported after five seconds

Five seconds after capture start the system SHALL warn if the microphone has delivered zero
bytes, naming the input device check (`set-copilot sources`) and the audio binary as the
things to inspect. In meeting mode it SHALL separately warn if the system channel has
delivered zero bytes, stating the monitor source is not delivering. Bytes are the cheapest
signal that the audio process is producing anything at all.

#### Scenario: Mic delivers nothing

- **WHEN** five seconds after start the microphone has delivered 0 bytes
- **THEN** a warning states that no audio is flowing from the mic and points to
  `set-copilot sources` and the audio binary

#### Scenario: Dictation does not warn about the system channel

- **WHEN** a `--mic-only` capture has run five seconds
- **THEN** no system-channel zero-byte warning is printed

### Requirement: Signal level is logged every minute

Every 60 seconds the capture SHALL log a line with the microphone's cumulative kilobytes and
the rms and peak level of the minute just ended, the system channel's cumulative kilobytes and
last-minute rms in meeting mode, and the cumulative count of transcript events received from
the microphone. The level SHALL be per minute, not per capture, so a microphone that goes dead
halfway through is visible while it is happening. Bytes alone are insufficient: a live but
deaf input delivers a flawless 32 kB/s of near-silence, so the byte counter climbs while
nothing can be transcribed.

#### Scenario: A dead mic is visible in the next stats line

- **WHEN** the microphone keeps delivering bytes but its signal drops to the noise floor
- **THEN** the next per-minute line shows the kilobytes still rising and the minute's rms at
  noise-floor level

### Requirement: A deaf capture is diagnosed after thirty seconds, naming which failure it is

Every 30 seconds, while the microphone has delivered bytes, the capture SHALL check two
distinct failures that both produce an empty transcript and need opposite fixes:

- if the loudest per-window rms of the whole capture so far is below the speech threshold
  (rms 300 — measured between a failed capture's noise floor of rms 68 and normal speech an
  order of magnitude above it), it SHALL warn that the level never rose above the noise floor,
  quoting the maximum rms and the threshold, and pointing to the input selection and its gain;
- otherwise, if no transcript event has come back from the microphone, it SHALL warn that
  speech-level audio is reaching the speech-to-text backend and nothing is returned, pointing
  to `set-copilot doctor`.

At most one of these warnings SHALL be printed per capture. A healthy check SHALL leave the
watchdog armed for a later failure.

#### Scenario: Audio flows but never reaches speech level

- **WHEN** the microphone has delivered 30 seconds of audio whose maximum rms is 68
- **THEN** a warning states the level never rose above the noise floor, quoting max rms 68 and
  the threshold 300

#### Scenario: Speech-level audio but no tokens

- **WHEN** the microphone's maximum rms exceeds 300 and no transcript event has arrived after
  30 seconds
- **THEN** a warning states the backend is receiving speech-level audio and returning nothing,
  and points to `set-copilot doctor`

#### Scenario: Zero bytes is left to the zero-byte warning

- **WHEN** the microphone has delivered 0 bytes at the 30-second check
- **THEN** neither deaf-capture warning is printed

### Requirement: An empty transcript explains itself at stop

When a capture stops having received no transcript event from the microphone, it SHALL print
exactly one `EMPTY TRANSCRIPT` diagnosis naming the input that was recorded — the configured
`micSource`, or "the system default input (no micSource configured)" — because which device was
actually recorded is the fact that resolves this class of failure and the one thing nobody can
see from outside. The diagnosis SHALL be the one matching the evidence:

- zero bytes: the audio process never produced anything;
- bytes, but maximum rms below the speech threshold: nothing was spoken into this input, with
  the duration and maximum rms;
- speech-level audio and still no tokens: either nothing intelligible was spoken into that
  input (noise alone reaches the threshold) or the backend is not transcribing — stated in that
  order, likeliest first, and NOT phrased as "the backend is broken".

Stop is the moment someone is reading — with dictation running in the background it is the
only moment — so the diagnosis SHALL be printed there.

#### Scenario: Noise-floor capture names the device

- **WHEN** a capture with no `micSource` configured received 40 seconds of audio at max rms 68
  and no transcript event, and is stopped
- **THEN** one `EMPTY TRANSCRIPT` line names the system default input, the duration, max rms
  68 and the threshold, and says nothing was spoken into this input

#### Scenario: A capture with tokens prints no diagnosis

- **WHEN** a capture that received at least one microphone transcript event is stopped
- **THEN** no `EMPTY TRANSCRIPT` line is printed

### Requirement: A low or muted input gain is reported at start

On Linux with PulseAudio/PipeWire, when `micSource` names a device, the capture SHALL read that
source's input volume and mute state at start and SHALL warn if it is muted, warn if the
volume is below 75 % (naming the `pactl set-source-volume … 100%` fix), and otherwise log the
gain. Conferencing apps move the per-device input gain and leave it there; at ~60 % a mic's
speech landed at rms 68 and transcribed to nothing, and that cause cannot be heard or seen in
the byte counter. When no device is named, `pactl` is unavailable, or the platform is not
Linux, the check SHALL stay silent rather than warn about the wrong device.

#### Scenario: Gain drifted down

- **WHEN** the configured mic source reports 59 % volume, unmuted
- **THEN** a warning states the gain is 59 % and names the command that raises it to 100 %

#### Scenario: No device named

- **WHEN** `micSource` is empty
- **THEN** no gain line and no gain warning is printed

### Requirement: Shutdown stops audio first and waits for the transcription tail

On `SIGINT` or `SIGTERM` the capture SHALL, in order: stop the audio processes (no new audio),
finalize every speech-to-text stream and wait for each to deliver its tail, print the empty-
transcript diagnosis if applicable, close the transcript writer, release the runtime dir and
exit 0. A second signal during shutdown SHALL NOT cut the finalize short. Tearing the stream
down synchronously threw away the final words of every dictation.

#### Scenario: Words spoken just before stop reach the transcript

- **WHEN** the operator speaks a sentence and the capture receives `SIGTERM` immediately after
- **THEN** the sentence's final tokens are written to the transcript before the writer closes

#### Scenario: A repeated signal does not abort the flush

- **WHEN** a second `SIGTERM` arrives while the capture is waiting for the transcription tail
- **THEN** the shutdown continues to wait and the tail is still written

### Requirement: `--max-minutes` stops the capture on its own

`capture --max-minutes N` with N greater than 0 (fractional values allowed) SHALL log the
auto-stop at start and, after N minutes, log that the maximum duration was reached and run the
same shutdown as a signal, so a capture needs no external timer to end.

#### Scenario: Timed dictation

- **WHEN** `set-copilot capture --mic-only --max-minutes 0.5` runs untouched
- **THEN** after 30 seconds it logs that the maximum duration was reached, flushes the tail and
  exits 0

### Requirement: A start tone marks the moment speech is captured

The capture SHALL play the start tone when the microphone's speech-to-text stream first reports
it is connected — not when the command is invoked — and SHALL NOT replay it on a reconnect. A
configured `audio.toneStart` file SHALL be played instead of the built-in tone when it exists.
Playback SHALL be fire-and-forget and SHALL never block or fail the capture.

#### Scenario: Tone on first connect only

- **WHEN** the microphone's real-time stream connects, later drops, and reconnects
- **THEN** the start tone is played once, at the first connect

### Requirement: `sources` lists the audio inputs a device name can be copied from

`set-copilot sources` SHALL print the audio sources a `micSource` or `monitorSource` can name.
On Linux it SHALL print the `pactl list sources short` lines (inputs and monitors, as PulseAudio
lists them). On macOS it SHALL read the operating system's own audio inventory
(`system_profiler SPAudioDataType -json`), list **input** devices only — an output-only device
is never offered as a mic — with the default input first and marked `(default input)` after the
bare name, so the name stays copy-pasteable. It SHALL NOT use `sox --help-device`, whose usage
error current sox builds returned as if it were the device list. A missing helper binary SHALL
yield an empty list, never a crash.

#### Scenario: macOS default input first

- **WHEN** a Mac has a built-in microphone (the default input), a USB microphone, and output-
  only speakers
- **THEN** `sources` lists the built-in microphone first marked `(default input)`, then the USB
  microphone, and does not list the speakers

#### Scenario: Helper binary missing

- **WHEN** `pactl` (Linux) or `system_profiler` (macOS) cannot be spawned
- **THEN** `sources` prints nothing and exits normally
