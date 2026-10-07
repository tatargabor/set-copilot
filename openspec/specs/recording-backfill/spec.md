# recording-backfill Specification

## Purpose
Find and save the recordings a machine holds under `.set/copilot/` that never reached the
repository — gitignored runtime state that a cleanup, a worktree swap or a new machine removes
without a trace. Back-fill decides "saved" by content (a byte-identical copy in the work tree, or a
recorded successful command hand-off), hands the rest over through the same seam a stop uses, never
moves or commits anything, and a session-start check tells the agent when something is unsaved.

## Requirements

### Requirement: Back-fill finds the recordings this machine never saved

`set-copilot backfill` SHALL scan the project's `.set/copilot/` directory, to a depth of four
directories, for recordings: files named `dictation*.jsonl` or `transcript*.jsonl`, excluding
`*-stitched.jsonl`. A live-named file (`transcript.jsonl`, `dictation.jsonl`) SHALL be included only
when no capture is alive in its directory. A directory holding `replay-run.json` SHALL be skipped:
a replay plays a scenario fixture back, it does not record this machine's speech. A file with no line carrying speech text SHALL NOT be
counted as a recording.

A recording SHALL count as saved when a file byte-identical to it (equal SHA-256) is present in the
git work tree among tracked or untracked-but-not-ignored files (files under a `.set/` directory never
count), or when the project's recovery ledger records a successful command hand-off (`handover` step,
via a command) of the same SHA-256. Every other recording is unsaved.
Identity SHALL NOT be decided by file name or path.

#### Scenario: An archived dictation with no copy is unsaved

- **WHEN** `.set/copilot/<session>/dictation-2026-10-05T17-27-54-794Z.jsonl` holds speech and no file
  in the work tree has the same SHA-256
- **THEN** back-fill lists it as unsaved, kind `dictation`

#### Scenario: A copy under another name counts as saved

- **WHEN** the same bytes are tracked as `notes/kept-copy.jsonl`
- **THEN** back-fill does not list the recording

#### Scenario: A live transcript of a running capture is left alone

- **WHEN** a `transcript.jsonl` sits in a directory whose capture is alive
- **THEN** back-fill neither lists nor reads it

#### Scenario: A replayed scenario is not a recording

- **WHEN** a runtime dir holds `transcript.jsonl` next to `replay-run.json`
- **THEN** back-fill neither lists nor hands it over

#### Scenario: A recording handed to a project command is not re-listed

- **WHEN** a recording's content was handed to a project command that exited 0 on this machine
- **THEN** back-fill does not list it, even though no byte-identical copy exists in the work tree

### Requirement: Back-fill hands over through the stop-time seam

For each unsaved recording, back-fill SHALL produce the readable and structured artifacts beside it
when they do not already exist, and SHALL hand it over exactly as a stop would for its kind
(`dictation` for `dictation*`, `meeting` for `transcript*`): the configured command for that kind with
the stop-time environment plus `SET_COPILOT_BACKFILL=1`, or the built-in target when none is
configured. Recordings SHALL be handed over in recording order. Back-fill SHALL NOT rename, move or
delete anything in a runtime directory, and SHALL NOT stage or commit anything; it SHALL end by
printing what was written by the built-in target and the `git add` command for it, and a reminder to
review what project commands reported.

#### Scenario: Back-fill saves an unsaved recording to the built-in target

- **WHEN** `backfill` runs in a project with no command configured for dictations and one unsaved
  dictation recorded on 2026-10-05
- **THEN** `docs/inputs/copilot/2026-10-05-dictation-part1.{jsonl,md}` and
  `…-part1-stitched.jsonl` are written, the runtime file is unchanged, and the `git add` line is
  printed

#### Scenario: Back-fill is idempotent

- **WHEN** `backfill` runs twice in a row with nothing recorded in between
- **THEN** the second run hands nothing over and writes nothing to the work tree

### Requirement: Back-fill keeps a machine-local record of what it did

Back-fill (and every stop-time hand-off) SHALL record successful hand-offs as `handover` steps in
the project's recovery ledger (`.set/copilot/recovery-log.jsonl`, the one content-keyed ledger the
engine keeps), and back-fill SHALL write a marker, `.set/copilot/backfill-last.json`, recording when
it last ran and which recordings it handed over, by what route, to where. Both are runtime state
beside the recordings they describe: per machine, and never a tracked path. `handover` SHALL NOT be a
step `recovery claim` or `recovery mark` accepts.

#### Scenario: The marker names the last run

- **WHEN** `backfill` hands over two recordings
- **THEN** `.set/copilot/backfill-last.json` records the run's time and both recordings with their
  route, and no tracked file changes because of it

### Requirement: A dry run and a session-start check report without writing

`backfill --dry-run` SHALL list each unsaved recording with its kind, date, size and where it would
go, and SHALL write nothing — no artifact, no ledger entry, no marker, no file in the work tree, and
no config file: for `--dry-run` and `--check` the config preflight only reports, it does not apply a
pending migration.
`backfill --check` SHALL be the same scan, SHALL print nothing when every recording is saved and one
summary line otherwise (the counts by kind, the commands to list and to save them, and when back-fill
last ran on this machine), and SHALL always exit 0 — also when the config cannot be loaded, in which
case it prints nothing.

`init` SHALL install `hooks/recordings-check.sh` and register it as a `SessionStart` hook. The script
SHALL run `backfill --check` in the project directory using a `set-copilot` found on `PATH` or in the
project's `node_modules/.bin`, SHALL do nothing when neither exists (never downloading a package),
SHALL exit 0 in every case, and SHALL work under both macOS and Linux.

#### Scenario: A dry run writes nothing

- **WHEN** `backfill --dry-run` runs in a project with unsaved recordings
- **THEN** each is listed, and the work tree, the runtime dirs and both config files are unchanged

#### Scenario: The check is silent when everything is saved

- **WHEN** `backfill --check` runs and every recording is saved
- **THEN** it prints nothing and exits 0

#### Scenario: The check tells the session about unsaved recordings

- **WHEN** a session starts in a project holding three unsaved dictations
- **THEN** the hook's output names three unsaved recordings and the `set-copilot backfill` command
