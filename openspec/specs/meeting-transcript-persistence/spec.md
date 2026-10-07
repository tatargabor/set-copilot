# meeting-transcript-persistence Specification

## Purpose
Guarantee that a meeting-mode capture, like dictation, hands its transcript over exactly once at
stop — archiving the live transcript to a durable, timestamped, discoverable artifact and reporting
its path — WITHOUT replaying the contents back into the session. This mirrors dictation's handover
invariant so a post-meeting step can find the full transcript, while never treating the whole
transcript as if freshly spoken.

## Requirements

### Requirement: A meeting transcript is handed over exactly once at stop

When a meeting-mode capture stops, the system SHALL hand the transcript over exactly once: it SHALL
archive the live transcript to a timestamped file and leave no live transcript that a later capture or a
repeated stop could replay as if freshly spoken. This mirrors the dictation handover invariant already
enforced for `/dd`.

#### Scenario: Meeting stop archives once

- **WHEN** a meeting-mode capture is stopped
- **THEN** the live transcript is renamed to a timestamped archive (`transcript-<timestamp>.jsonl`) and its
  path is reported, and no live transcript remains at the configured path

#### Scenario: A repeated stop does not re-hand-over

- **WHEN** `stop` runs again after the transcript was already handed over
- **THEN** nothing is re-archived and nothing is re-emitted — the second stop reports that there is nothing
  to hand over

### Requirement: Handover persists a durable, discoverable artifact without reprinting contents

The meeting handover SHALL produce a durable, timestamped transcript file in the capture's runtime dir and
SHALL report that file's path, WITHOUT printing the transcript contents back to the caller. Emitting the
contents SHALL remain a separate, explicit opt-in used by dictation, so the meeting flow never replays a
whole transcript into the session as if it were freshly spoken.

After archival, the handover SHALL additionally produce the readable Markdown transcript and the
sentence-level structured JSONL from the **archived** file, write them beside it, and report all three
paths. Producing them at stop is what makes the readable transcript the artifact that is actually at hand
when a downstream step starts — the loss this change exists to prevent came from a processing step reading
the raw file because that was the one available. Failure to produce the derived artifacts SHALL NOT fail
the handover: the archive is the invariant, the derived files are a convenience, so a stitch error SHALL be
reported and the archived path still returned.

The dictation opt-in SHALL emit the dictated text **reassembled into sentences**, not the raw transcript
body. The raw text is the user's message, and handing a consumer fragments obliges it to guess a word
boundary it has no information to resolve — the very question the capture records `cont` / `midWord` to
answer. After the text is emitted and the transcript archived, a dictation stop SHALL also produce the
readable Markdown and the structured JSONL beside the archive, from the archived file and under the same
`transcript.stitchOnStop` setting, reporting their paths on stderr only: the emitted message is unchanged,
and the readable file exists so that the dictation, once persisted, can be found by a text search like any
other recording.

#### Scenario: Path reported, contents withheld (meeting)

- **WHEN** a meeting-mode capture stops with archival
- **THEN** the saved archive path is printed and the transcript body is NOT printed

#### Scenario: Dictation still prints and archives once

- **WHEN** a dictation stop requests the contents (the `/dd` path)
- **THEN** the contents are emitted and the transcript is archived exactly once, and nothing the
  derived-artifact step or the hand-off reports reaches stdout

#### Scenario: Dictation emits reassembled text, not raw lines

- **WHEN** a dictation stop requests the contents and the transcript was fragmented by the
  capture's flush rules
- **THEN** the emitted text is the reassembled dictation, with word boundaries resolved from what
  the capture recorded, and carries no transcript syntax for the consumer to parse

#### Scenario: Stop reports the readable and structured artifacts

- **WHEN** a meeting-mode capture stops with archival and a non-empty transcript
- **THEN** the readable `.md` and the sentence-level `.jsonl` are written next to the archive, and all
  three paths are printed

#### Scenario: A stitch failure does not lose the archive

- **WHEN** the derived-artifact step fails on an archived transcript
- **THEN** the failure is reported and the archived transcript path is still returned, with the archive
  left intact

#### Scenario: A dictation stop writes the readable artifacts off the message channel

- **WHEN** a dictation stop archives a non-empty transcript with `transcript.stitchOnStop` enabled
- **THEN** the `.md` and `-stitched.jsonl` are written beside the archive, their paths appear on
  stderr prefixed `[set-copilot]`, and neither appears on stdout

### Requirement: Archival never truncates and respects runtime-dir ownership

Handover SHALL archive by renaming rather than truncating, and SHALL act only on the transcript owned by the
stopping capture's runtime dir. A stop invoked with no live capture but an unconsumed transcript still
present SHALL hand that transcript over once (covering a capture that self-stopped on `--max-minutes`).

#### Scenario: Timer-expired capture is still handed over

- **WHEN** a capture already self-stopped on its `--max-minutes` limit and a later `stop` runs in the same
  runtime dir
- **THEN** the leftover transcript is archived exactly once and its path reported

#### Scenario: The prior transcript stays readable

- **WHEN** handover runs
- **THEN** the previous transcript remains readable under its archived, timestamped name (never truncated)

### Requirement: A project command may run after the handover

The handover SHALL support a configured project command (`copilot.handoverCommand`) that runs
**after** the transcript is archived and the derived artifacts are written, receiving the archived
paths, so a project-specific hand-off (moving the transcript out of the gitignored runtime dir into
the project's own inputs) needs no fork of the shared skill. The command SHALL receive, through the
environment, `SET_COPILOT_TRANSCRIPT` (the archive), `SET_COPILOT_TRANSCRIPT_MD` and
`SET_COPILOT_TRANSCRIPT_JSONL` (when produced), `SET_COPILOT_DIR`, `SET_COPILOT_KIND=meeting`, and
`SET_COPILOT_RECORDED_AT` (the recording's ISO timestamp), plus `COPILOT_HANDOVER_SLUG` when the
caller's environment carries it. The kind SHALL be the recording's own — `dictation` for a file
named `dictation*`, `meeting` otherwise — whichever stop path archived it: a plain `stop` (the
SessionEnd hook) that archives a dictation left open SHALL hand it on as a dictation. Absent configuration SHALL leave the archive and the derived
artifacts exactly as they are today and SHALL persist the recording to the built-in target instead
of running a command.

The command SHALL NOT be able to fail the handover: a non-zero exit, a missing executable, or a
timeout SHALL be reported and the archived path still returned, on the same reasoning the derived
artifacts already follow — the archive is the invariant, everything after it is a convenience. It is
what makes the shared skill sufficient for a project that would otherwise keep its own copy; without
it, measured 2026-07-30, six transcripts stayed unhanded under `.set/copilot/`, the largest 18 500
words, with no input record anywhere pointing at them. A command that exits 0 SHALL be recorded as a
successful hand-off of that recording's content — a `handover` step in the project's recovery
ledger (`recording-backfill`); a failed one SHALL NOT be.

#### Scenario: The configured command runs after archival

- **WHEN** a meeting-mode capture stops with `copilot.handoverCommand` configured
- **THEN** the transcript is archived, the derived artifacts are written, and only then is the
  command run, with the archived paths and `SET_COPILOT_KIND=meeting` available to it

#### Scenario: A failing command does not lose the handover

- **WHEN** the configured command exits non-zero, cannot be executed, or exceeds its time limit
- **THEN** the failure is reported and the archived transcript path is still returned, with the
  archive left intact, and no successful hand-off is recorded

#### Scenario: No command configured leaves the handover unchanged

- **WHEN** a meeting-mode capture stops with no `copilot.handoverCommand` configured
- **THEN** the archive and the derived artifacts are produced exactly as before, no project command
  is run, and the recording is persisted to the built-in target

### Requirement: The meeting-copilot stop flow surfaces the saved transcript

The `meeting-copilot` skill's stop flow SHALL trigger the archival handover and SHALL report the saved
transcript paths in its closing summary, so the operator (or a follow-up processing step) can find the full
meeting transcript after the session. The summary SHALL name the readable transcript as the source intended
for downstream knowledge processing, and the raw JSONL as the archive of record.

The skill SHALL additionally state two facts about those artifacts, both of which a project
otherwise learns by forking the skill and writing them down itself:

- **why `--print` is not the way to hand a meeting transcript over** — it replays the whole
  transcript back into the session as if freshly spoken, which is the failure the handover
  invariant exists to prevent; and
- **that the raw `.jsonl` holds flush fragments, not sentences**, so any post-processing reads the
  readable `.md`, which is the artifact the stitch produced for exactly that purpose.

#### Scenario: Stop summary names the saved file

- **WHEN** `/meeting-copilot stop` runs
- **THEN** the closing summary includes the archived transcript's path alongside the meeting summary

#### Scenario: Stop summary points knowledge processing at the readable transcript

- **WHEN** `/meeting-copilot stop` runs and the derived artifacts were produced
- **THEN** the closing summary names the readable transcript as the source for note-taking and knowledge
  extraction, and the raw JSONL as the archive

#### Scenario: The skill states why the transcript is not printed

- **WHEN** the stop flow's instructions are read
- **THEN** they forbid `--print` for a meeting transcript and give the reason (it replays the whole
  transcript into the session), rather than leaving the prohibition unexplained

#### Scenario: The skill warns that the raw JSONL is fragments

- **WHEN** the stop flow's instructions name the three artifacts
- **THEN** they state that the raw JSONL consists of flush fragments and that downstream processing
  reads the readable `.md`

### Requirement: Stop-time stitching is configurable

Producing the derived artifacts at stop SHALL be controlled by configuration
(`transcript.stitchOnStop`), defaulting to enabled, for a meeting and a dictation stop alike.
Disabling it SHALL write no derived artifacts at stop, and SHALL NOT affect the standalone
`set-copilot transcript` command. The hand-off still runs: a project command receives no derived
paths, and the built-in target copies the raw recording alone.

#### Scenario: Stitching disabled at stop

- **WHEN** `transcript.stitchOnStop` is set to false and a meeting capture stops
- **THEN** only the archived transcript is produced beside the archive and its path reported, no
  derived artifacts are written, and a built-in target copy, if made, holds the raw file alone

#### Scenario: The command works regardless of the stop setting

- **WHEN** `transcript.stitchOnStop` is false and `set-copilot transcript` is run explicitly
- **THEN** the derived artifacts are produced

### Requirement: A project command may run after a dictation handover

The dictation stop path (`stop --print`) SHALL support its own configured project command,
`copilot.dictationHandoverCommand`, run **after** the dictated text was emitted, the transcript
archived and the derived artifacts written, and only when something was archived. It SHALL receive
the same environment as the meeting command — `SET_COPILOT_TRANSCRIPT`, `SET_COPILOT_TRANSCRIPT_MD`
and `SET_COPILOT_TRANSCRIPT_JSONL` when produced, `SET_COPILOT_DIR`, `SET_COPILOT_RECORDED_AT` — with
`SET_COPILOT_KIND=dictation`. It SHALL be a separate key from `copilot.handoverCommand`: the meeting
command SHALL NOT run on a dictation stop, and the dictation command SHALL NOT run on a meeting stop.
An absent or empty value SHALL run no command and SHALL persist the dictation to the built-in target;
a value that is not a string SHALL be ignored with a warning naming the key.

The command SHALL NOT be able to fail the handover: a non-zero exit, a missing executable, or
exceeding its 60-second limit SHALL be reported with the archived path, and the archive SHALL stay
intact — the same posture `copilot.handoverCommand` takes, because the rename is the invariant and
everything after it is a convenience. A command that exits 0 SHALL be recorded in the recovery
ledger, as for a meeting.

Dictation transcripts land in the gitignored runtime directory, and lifting them into a project's
inputs was left to a later manual step. Measured in a consumer project: the lift script existed and
nothing called it, every saved dictation came from a hand-run, and the ones nobody ran it for were
simply gone — silently, because an inputs tree with no dictations in it looks exactly like a project
where nobody dictated.

#### Scenario: The command runs after print and archive

- **WHEN** a dictation stop runs with `copilot.dictationHandoverCommand` configured and a non-empty
  transcript
- **THEN** the dictated text is emitted, the transcript is archived, and only then is the command run
  with `SET_COPILOT_TRANSCRIPT` naming the archived file and `SET_COPILOT_KIND=dictation`

#### Scenario: A dictation archived by a plain stop is still a dictation

- **WHEN** a session ends during a dictation and the SessionEnd hook's plain `stop` archives
  `dictation.jsonl`, with only `copilot.handoverCommand` configured
- **THEN** the meeting command does not run, and the recording is handed on as kind `dictation`

#### Scenario: Nothing archived, nothing run

- **WHEN** a dictation stop finds no transcript, or an empty one
- **THEN** the command is not run and nothing is persisted

#### Scenario: The keys do not cross paths

- **WHEN** only `copilot.handoverCommand` is configured and a dictation stop runs
- **THEN** no project command runs on that stop, and the dictation is persisted to the built-in
  target

#### Scenario: A failing command does not lose the dictation

- **WHEN** the configured command exits with status 3
- **THEN** a report naming `copilot.dictationHandoverCommand`, the failure, and the intact archived
  path is emitted, and the transcript remains archived

### Requirement: The dictation hand-off never speaks inside the dictated message

The output of `copilot.dictationHandoverCommand` SHALL NOT reach the stream that carries the dictated
text. Its stdout and stderr SHALL be captured and re-emitted on stderr, one line at a time, each
non-blank line prefixed `[set-copilot] handover: `; its failure report SHALL likewise go to stderr
with the `[set-copilot]` prefix. This is the one behaviour in which it differs from
`copilot.handoverCommand`, whose output is inherited unchanged.

On the dictation path stdout is the channel the user's spoken words travel on, and whatever the
consumer reads there it reads as part of the user's instruction. A project script announcing where
it filed the transcript would splice a sentence the user never said into their own message — a
corruption with no recording to go back to. Re-emitting on stderr keeps the report visible to the
operator, and the prefix is what tells a reader, human or model, that the line is the tooling
talking.

#### Scenario: The command's stdout stays out of the message

- **WHEN** the configured command prints `saved to inputs/dictation/x.md` on stdout during a dictation
  stop
- **THEN** stdout carries only the dictated text, and stderr carries
  `[set-copilot] handover: saved to inputs/dictation/x.md`

#### Scenario: Blank lines are not forwarded

- **WHEN** the configured command prints blank lines among its output
- **THEN** only the non-blank lines are re-emitted, each with the prefix

### Requirement: A recording with no configured command persists to the built-in target

When a stop hands over a recording of a kind whose command key (`copilot.handoverCommand` for a
meeting, `copilot.dictationHandoverCommand` for a dictation) is not configured, the system SHALL copy
the recording into `docs/inputs/copilot/` of the git work tree that contains the project root,
creating the directory if needed: the raw archive byte for byte as `<base>.jsonl`, and, when they
were produced, the readable transcript as `<base>.md` and the structured transcript as
`<base>-stitched.jsonl`. `<base>` SHALL be `<YYYY-MM-DD>-<kind>-part<N>-<sha8>`, where `<kind>` is
`dictation` or `meeting`, the date is the recording's local date, `N` is the lowest part number of
that date and kind not used by any name on disk, in `HEAD`, or in the current branch's upstream tree
(read locally, without fetching), and `<sha8>` is the first eight hex digits of the raw file's
SHA-256 — so two machines that each save a different recording as `part1` before pulling never meet
in a git conflict. Each file SHALL be written under a temporary name and renamed into place.

The copy SHALL be skipped when a file byte-identical to the raw archive (equal SHA-256) is already
present in the work tree among tracked or untracked-but-not-ignored files, or anywhere under
`docs/inputs/copilot/`; files under any `.set/` directory SHALL NOT count, and identity SHALL NOT be
decided by file name. It SHALL be skipped when the recording holds no line of speech, and outside a
git work tree, with a note naming the archive. The system SHALL NOT stage or commit anything; it SHALL
report the paths it wrote and the `git add` command for them, each line prefixed `[set-copilot]` — on
stdout for a meeting, on stderr for a dictation stop. A failure of the copy SHALL be reported and
SHALL NOT fail the stop. A configured command for that kind SHALL replace the built-in target
entirely; a project that wants no copy at all configures a command that does nothing (`true`).

The built-in target SHALL also stand down — before any copy is attempted, with the same report
shape and the archive left in place — when `copilot.defaultHandover` (default `"auto"`) does not
permit it. Under `"auto"` the target stands down when the work tree has a git remote on a known
public hosting host — github.com, gitlab.com, codeberg.org, bitbucket.org, sr.ht, framagit.org,
gitea.com — where a remote's host matches when it equals a listed one or is one of its subdomains
(`git.sr.ht` matches `sr.ht`, since no sourcehut remote ever appears at the apex; a host under a
different apex, like a dedicated `github.company.com` GitHub Enterprise install, is not a
subdomain of `github.com` and does not match — the operator who wants it suppressed sets
`copilot.defaultHandover`) — unless the machine-local visibility cache
(`repo-visibility.json` beside the user config, keyed by the work tree's canonical top —
`realpathSync` of `git rev-parse --show-toplevel`, so a symlink or an alternative spelling still
finds its mark) marks that work tree `private`. A work tree with no remote, a remote on any other
host, or a `private` cache mark SHALL keep the default behaviour. `"on"` SHALL force the copy and
`"off"` SHALL force the stand-down, whatever the remotes say. The decision SHALL be made from
local reads only — `git remote -v` and the cache file — and SHALL NOT make a network call. A
suppressed recording SHALL be reported once, prefixed `[set-copilot]`, on the stream the built-in
target's own report uses (stderr for a dictation stop, stdout for a meeting and back-fill),
naming the reason, the offending host, and where the fix lives (the cache mark or the config
key), and SHALL NOT be recorded as a `handover` step in the recovery ledger; the recording stays
at its archived path. Back-fill SHALL count a suppressed recording as deliberately kept — neither
as handed over nor as failed — SHALL report the suppression once per run rather than once per
recording, and a run whose recordings are all suppressed SHALL exit 0.

#### Scenario: A dictation in a project with no dictation command is saved with its readable file

- **WHEN** a dictation stop runs in a git work tree with no `copilot.dictationHandoverCommand` and a
  non-empty transcript, on 2026-10-07 with no earlier copies that day
- **THEN** `docs/inputs/copilot/2026-10-07-dictation-part1-<sha8>.jsonl` is byte-identical to the
  archive, `…-part1-<sha8>.md` and `…-part1-<sha8>-stitched.jsonl` exist beside it, nothing is staged,
  and the paths are reported on stderr, prefixed `[set-copilot]`, never on stdout

#### Scenario: A content-identical copy is not saved twice

- **WHEN** the built-in target runs for a recording whose raw bytes already exist anywhere in the work
  tree under any name
- **THEN** nothing is written and the existing copy's path is reported

#### Scenario: Part numbers do not collide

- **WHEN** `2026-10-07-meeting-part1-<sha8>.jsonl` already exists and a different 2026-10-07
  meeting is handed over
- **THEN** it is written as `2026-10-07-meeting-part2-<its sha8>.*`

#### Scenario: Runtime state is never a saved copy

- **WHEN** a project does not ignore `.set/` and a dictation is handed over to the built-in target
- **THEN** the archive under `.set/copilot/` does not count as an existing copy, and the copy is
  written

#### Scenario: A recording with no speech is not copied

- **WHEN** a dictation stop archives a transcript holding only a `silence` event
- **THEN** nothing is written to `docs/inputs/copilot/`

#### Scenario: A configured command replaces the default

- **WHEN** a meeting stops with `copilot.handoverCommand` configured
- **THEN** nothing is written to `docs/inputs/copilot/` by the engine

#### Scenario: Outside a git work tree nothing is created

- **WHEN** a stop with no configured command runs from a directory that is not inside a git work tree
- **THEN** no directory is created, and a note names the archived recording

#### Scenario: A public remote stands the default target down

- **WHEN** a stop hands a recording to the built-in target in a work tree whose remote is
  `git@github.com:owner/repo.git`, with `copilot.defaultHandover` unset (or `"auto"`) and no
  visibility-cache mark
- **THEN** nothing is written to `docs/inputs/copilot/`, one `[set-copilot]`-prefixed line on the
  report stream names the stand-down, `github.com`, and where the fix lives, no `handover` step is
  recorded in the recovery ledger, and the archived recording is intact in the runtime dir

#### Scenario: A subdomain of a listed host matches

- **WHEN** the work tree's remote is `git@git.sr.ht:~user/repo.git` (or `https://git.sr.ht/~user/repo`)
- **THEN** the host matches the listed `sr.ht` and the target stands down, as for `github.com` itself

#### Scenario: A private mark on a public host keeps the default

- **WHEN** the visibility cache marks the work tree `private` and the built-in target runs
- **THEN** the copy is made exactly as when the rule does not apply

#### Scenario: A remote on a non-public host keeps the default

- **WHEN** the work tree's only remote is on a company GitLab (`git@git.example.hu:owner/repo.git`)
  or there is no remote at all
- **THEN** the copy is made exactly as when the rule does not apply

#### Scenario: The explicit override wins in both directions

- **WHEN** `copilot.defaultHandover` is `"on"` in a work tree with a github.com remote, or `"off"`
  in a work tree with no remote
- **THEN** the copy is made in the first case, and nothing is written (with the stand-down report
  naming the config) in the second

#### Scenario: The decision makes no network call

- **WHEN** the stand-down rule is evaluated during a stop with no network access
- **THEN** the decision completes from `git remote -v` and the cache file alone

#### Scenario: Back-fill counts a suppressed recording as deliberately kept

- **WHEN** back-fill runs in a work tree the rule suppresses and finds recordings with no copy
- **THEN** the run reports the suppression once for the whole run rather than once per recording,
  no suppressed recording is counted as handed over or as failed, the run exits 0 when nothing
  else failed, and `--check` reports no unsaved recording for them
