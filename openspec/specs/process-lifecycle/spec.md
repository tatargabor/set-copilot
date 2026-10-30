# process-lifecycle Specification

## Purpose
Govern the lifecycle of the long-running processes — a capture (or a replay, which owns a runtime
dir the same way) and a wall: how each claims its runtime dir, how a second one is refused and a
dead one's claim reclaimed, how they outlive the tool call that started them, how `stop` and
`wall-stop` find and end exactly the process their runtime dir names, and how `status` and `path`
expose that state to the skills. Transcript archival is specified in
`meeting-transcript-persistence` and wall event-log rotation in `wall-scroll-replay`; this
capability references them rather than restating them.

## Requirements
### Requirement: A runtime dir has exactly one capture owner

A capture SHALL claim its runtime dir before recording, and the claim SHALL be the only way a
process becomes the dir's owner. The claim SHALL:

- refuse, with a non-zero exit and a message naming the owning PID and the dir, when
  `capture.pid` names a live process — and SHALL do so **before touching anything on disk**, so a
  refused start cannot damage the recording it exists to protect;
- treat a `capture.pid` that is absent, unparseable, or names a process that no longer exists as
  unowned, and reclaim it — a capture killed with SIGKILL, or a reboot, leaves one behind, and a
  leftover must never lock the dir forever;
- archive an unconsumed non-empty transcript at the output path by renaming it (never truncating
  it), per `meeting-transcript-persistence`;
- record `capture.pid`, `capture.output` (the transcript this owner writes — dictation and meeting
  mode differ) and a `poll-offset` reset to `0`.

The capture SHALL remove `capture.pid` when it shuts down. A replay claims the dir through the same
rule and the same `capture.pid` file name, so no consumer has to know a replay exists.

Before this rule, a second capture truncated the first's transcript and overwrote its PID file, so
the first process kept recording with nothing able to stop it.

#### Scenario: A second capture is refused and changes nothing

- **WHEN** a capture is live in a runtime dir and another capture starts in the same dir
- **THEN** the second exits non-zero naming the live PID, and the first's transcript and PID file
  are byte-identical to before

#### Scenario: A stale PID file is reclaimed

- **WHEN** `capture.pid` names a process that no longer exists and a capture starts
- **THEN** the capture starts normally and records its own PID

#### Scenario: The claim records what consumers read

- **WHEN** a capture claims a dir for a dictation
- **THEN** `capture.pid` holds its PID, `capture.output` holds the dictation transcript path, and
  `poll-offset` is `0`

### Requirement: A wall claims its runtime dir through wall.pid and wall.url

A wall SHALL refuse to start, with an error naming the live PID and the dir, while `wall.pid` in
its runtime dir names a live process; a `wall.pid` naming a dead process SHALL be treated as stale
and reclaimed. An event-log rotation requested with `--reset` SHALL happen only **after** that
check, so a running wall's log is never rotated out from under it (`wall-scroll-replay`).

When the requested port is taken, the wall SHALL try the following ports, up to 20 in all, and fail
naming the range only when none binds. Once bound, it SHALL write its PID to `wall.pid` and the URL
it actually bound to `wall.url`, so a launcher can read back the real port, and SHALL remove both
files when it exits.

#### Scenario: A second wall is refused

- **WHEN** a wall is live in a runtime dir and another wall starts in the same dir
- **THEN** the second fails naming the live PID, and the first's `wall.pid` is unchanged

#### Scenario: A taken port is walked past

- **WHEN** the configured wall port is already in use
- **THEN** the wall binds the next free port within the range and `wall.url` names that port

#### Scenario: A clean exit leaves no claim

- **WHEN** a wall receives SIGTERM
- **THEN** `wall.pid` and `wall.url` are removed

### Requirement: Long-running commands can outlive the tool call that started them

`capture` and `wall` SHALL accept `--detach`. With it, the command SHALL re-launch itself without
the flag in its own session, with `SET_COPILOT_DIR` pinned to the runtime dir it resolved and its
output appended to `<runtimeDir>/<command>.log`, then watch the child for 1.5 seconds. If the child
is still running, the command SHALL print its PID and log path and exit successfully; if the child
exited during that window, it SHALL exit non-zero, naming the child's exit code and the log path
and printing the log's last lines. Any other command SHALL ignore `--detach`.

Measured on a two-hour call (2026-10-01): run as a background command, a capture was killed by the
harness's background time limit — after 30 minutes, and on restart at exactly two hours,
mid-sentence, with the wall going down with it — and nothing said so until the transcript ran out.
A detached process lives until `stop` / `wall-stop` (which find it by its PID file, unchanged) or
its own `--max-minutes`.

#### Scenario: A detached capture keeps running

- **WHEN** `capture --detach` is run and the capture starts successfully
- **THEN** the command returns within about 1.5 seconds, prints the child PID and the log path,
  and the capture keeps recording in its own session

#### Scenario: A start-up failure is not reported as success

- **WHEN** `wall --detach` is run and the wall exits during start-up (for example, a wall is
  already live in the dir)
- **THEN** the command exits non-zero, names the exit code and `<runtimeDir>/wall.log`, and prints
  the tail of that log

### Requirement: Stop ends the capture and waits for its flush

`stop` SHALL find the capture through its runtime dir's `capture.pid`, send it SIGTERM, and wait up
to 10 seconds for the process to exit before handing the transcript over, so the capture's shutdown
flush completes before anything reads the transcript. The budget covers the transcription service's
end-of-stream round trip; an earlier 2-second wait cut the flush off and the caller received a
transcript missing its last words. A PID file naming a process that is already gone SHALL be
reported as already stopped. With no `capture.pid` at all, `stop` SHALL report that no capture is
running and still perform the hand-over, because a capture that hit its `--max-minutes` limit
removed its own PID file but left its transcript (`meeting-transcript-persistence`).

#### Scenario: Stop waits for the flush

- **WHEN** `stop` runs while a capture is live
- **THEN** the hand-over begins only after the capture process has exited, or after 10 seconds
  have passed

#### Scenario: Stop with no capture still hands over

- **WHEN** `stop` runs in a runtime dir with no `capture.pid` but an unconsumed transcript
- **THEN** it reports that no capture is running and hands the transcript over once

### Requirement: wall-stop ends exactly the wall its runtime dir names

`wall-stop` SHALL find the wall through its runtime dir's `wall.pid`, so a session tears down the
wall it started and never another project's. It SHALL send SIGTERM, wait up to 5 seconds for the
process to exit, and remove `wall.pid` and `wall.url` whether or not the process was still alive —
a stale claim would otherwise be read by the next consumer as a running wall. With no `wall.pid`,
it SHALL report that no wall is running.

#### Scenario: wall-stop clears a dead wall's claim

- **WHEN** `wall.pid` names a process that is already gone and `wall-stop` runs
- **THEN** it reports the wall as already stopped and both `wall.pid` and `wall.url` are removed

#### Scenario: No wall

- **WHEN** `wall-stop` runs in a runtime dir with no `wall.pid`
- **THEN** it reports that no wall is running and changes nothing

### Requirement: status reports the capture state and the file it writes

`status` SHALL print one line stating whether a capture (or replay) is live in the runtime dir —
by the same liveness rule the claim uses — together with the transcript path the owner recorded in
`capture.output` (the dictation transcript path when no owner ever recorded one) and that file's
non-empty line count.

#### Scenario: A live meeting capture

- **WHEN** a meeting capture is live and has written 12 lines
- **THEN** `status` prints `capture: running`, the meeting transcript path, and `12 lines`

#### Scenario: Nothing ever ran

- **WHEN** `status` runs in a fresh runtime dir
- **THEN** it prints `capture: stopped` with the dictation transcript path and `0 lines`

### Requirement: path prints a resolved runtime path by name

`path <name>` SHALL print the resolved path for one of `runtime`, `transcript`, `dictation`,
`keywords`, `context`, `digest`, `wall-url` and `wall-pid`, so a skill asks the CLI where a file
lives instead of re-deriving the resolution rules. An unknown or missing name SHALL print a usage
line listing the valid names and exit non-zero.

#### Scenario: A known name

- **WHEN** `path runtime` runs with `SET_COPILOT_DIR` set
- **THEN** it prints that directory

#### Scenario: An unknown name

- **WHEN** `path bogus` runs
- **THEN** it prints the usage line naming every valid name and exits non-zero
