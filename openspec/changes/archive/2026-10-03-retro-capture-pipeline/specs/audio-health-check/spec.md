# Spec Delta

## Purpose

Answer "the capture says connected but the transcript stays empty — why?" by probing the real
recording chain — backend prerequisites, audio binary, devices, bytes and signal — instead of
guessing, and exit non-zero exactly when this machine cannot record. The configuration-drift
and mirror-readiness sections of the same command are specified in `setup-diagnostics`.

## ADDED Requirements

### Requirement: The health check verifies the selected backend's prerequisites

`set-copilot doctor` SHALL check the prerequisites of the configured speech-to-text backend and
report each as passed or failed. For the whisper backend it SHALL check that the configured
whisper binary can be executed and that the configured model file exists, naming the binary or
the model path and the install or download step on failure. For the Soniox backend it SHALL
check that `SONIOX_API_KEY` resolves, and on failure state that it belongs in `.env` or the
environment. It SHALL NOT print the key.

#### Scenario: Whisper backend without a model

- **WHEN** `doctor` runs with the whisper backend selected and the configured model file is
  absent
- **THEN** it reports the model as missing with its path and how to obtain one, and the
  command's exit status is non-zero

#### Scenario: Soniox key present

- **WHEN** `doctor` runs with the Soniox backend and `SONIOX_API_KEY` set
- **THEN** it reports the key as set without printing its value

### Requirement: Audio binary resolution is reported and never crashes the check

The health check SHALL resolve the audio binary exactly as capture does (`parec` on Linux,
`sox` on macOS, with the same preferred install paths) and report which binary it will use. If
that binary cannot be executed it SHALL report a failure with the platform's install hint, skip
the signal probes, and still complete the rest of the report. A missing binary in source
listing SHALL yield an empty list rather than an unhandled spawn error — such an error once
killed the process with a stack trace right after the binary had been cleanly reported as
absent.

#### Scenario: sox not installed on macOS

- **WHEN** `doctor` runs on a Mac with no sox installed
- **THEN** it reports sox as not runnable with the install hint, performs no signal probe,
  prints the remaining sections, and exits non-zero without a stack trace

### Requirement: The configured devices and available sources are shown

The health check SHALL list the available audio sources (the same list `set-copilot sources`
prints) and SHALL show the configured `micSource` and `monitorSource`, stating explicitly when
either is empty that the system default (or `@DEFAULT_MONITOR@` for the monitor) is in force —
because an unset device silently lands on a default that may be any device at all.

#### Scenario: Empty micSource is named as the default

- **WHEN** `doctor` runs with `micSource` empty
- **THEN** the report shows the mic source as empty with the system default in force

### Requirement: Each source is probed for real signal, with one retry

When the audio binary is runnable, the health check SHALL record about 3 seconds from the
microphone — and on Linux also from the system monitor — and report the bytes received and the
peak amplitude. A probe that yields 0 bytes SHALL be retried once, because a suspended device
can take over a second to resume and occasionally yields nothing on first open. A probe SHALL be
force-killed at 3 seconds and abandoned at 5 seconds, so a wedged audio binary cannot hang the
check. The verdict SHALL distinguish:

- 0 bytes: failure — no audio is flowing (wrong device, broken binary, or on macOS a missing
  permission);
- bytes with a peak of exactly 0: digital silence — for the microphone a warning that the device
  is probably wrong (the operator should speak during the probe), for the monitor normal when
  nothing is playing; neither is a failure;
- bytes with a non-zero peak: the signal is live.

#### Scenario: Suspended mic recovers on retry

- **WHEN** the first microphone probe yields 0 bytes and the retry yields audio with a non-zero
  peak
- **THEN** the microphone is reported as live and is not counted as a failure

#### Scenario: Silent monitor is normal

- **WHEN** on Linux the monitor probe delivers bytes with a peak of 0
- **THEN** the monitor is reported as delivering, with silence noted as normal when nothing is
  playing, and is not counted as a failure

#### Scenario: Mic yields nothing

- **WHEN** both microphone probe attempts yield 0 bytes
- **THEN** the microphone is reported as a failure and the exit status is non-zero

### Requirement: A macOS zero-byte probe names the app that holds the Microphone permission

On macOS, when a probe yields 0 bytes, the health check SHALL state that this is almost always a
missing Microphone permission rather than a wrong device, and SHALL name the application to
grant it to: the nearest `.app` bundle found walking the process ancestry from this process
upward (bounded depth), falling back to a generic "your terminal/IDE application" when none is
found. It SHALL also state that the application must be restarted, because the grant only reaches
processes started after it. The permission belongs to the enclosing app, not to `sox` or to node,
and sox opens the device and prints nothing when it is denied — so "wrong device or broken
binary" sent operators to edit a configuration that was never the problem.

#### Scenario: Shell inside an editor app

- **WHEN** `doctor` runs on macOS in a shell whose ancestry includes a process under
  `/Applications/Zed.app/…` and the microphone probe yields 0 bytes
- **THEN** the report names `Zed` as the app to grant the Microphone permission to and says to
  restart it

#### Scenario: Nearest bundle wins

- **WHEN** the ancestry contains a helper inside one `.app` bundle below a different enclosing
  `.app`
- **THEN** the nearest bundle (closest to this process) is named

#### Scenario: Pure CLI ancestry

- **WHEN** no process in the ancestry runs from a `.app` bundle
- **THEN** the report falls back to the generic terminal/IDE wording

### Requirement: The exit status means exactly "this machine cannot record"

`doctor` SHALL exit non-zero if and only if a recording-chain check failed: a missing backend
prerequisite, an audio binary that cannot run, or a probe that yields 0 bytes. Configuration-
drift and mirror-readiness findings SHALL NOT affect the exit status. The closing summary SHALL
be scoped to the recording chain: on failure it SHALL say to fix the failed items before
recording; when the chain passes but advisory warnings were printed, it SHALL say the chain is
fine and the warnings do not block recording, rather than print a blanket all-clear over them.
Diluting the exit status would make it useless to the scripts and skills that gate a recording
on it.

#### Scenario: Drift alone does not fail the check

- **WHEN** every recording-chain check passes and the configuration report contains a warning
- **THEN** `doctor` exits 0 and its summary says the recording chain is fine while the warning
  stands

#### Scenario: Silent mic is not a failure

- **WHEN** the microphone probe delivers bytes with a peak of 0 and every other chain check
  passes
- **THEN** `doctor` exits 0, with the digital-silence warning printed for the microphone
