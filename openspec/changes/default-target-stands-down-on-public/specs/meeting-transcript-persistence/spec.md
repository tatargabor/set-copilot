# Spec Delta

## IN SCOPE

- The `copilot.defaultHandover` config key (`"on" | "off" | "auto"`, default `"auto"`) and its
  resolution.
- The offline-first public-repo decision: git remotes on a known public host, the machine-local
  visibility cache that can mark a work tree private, and the precedence of the explicit
  override.
- The stand-down of the built-in target when the rule says public: the report, the untouched
  archive, and the absent ledger record.
- Back-fill counting a suppressed recording as deliberately kept, and reporting the suppression
  once per run.

## OUT OF SCOPE

- Any network check of a repository's actual visibility (an API lookup): a stop must never
  block on, or fail open because of, a network call. The cache is the operator's offline answer.
- Gating a configured per-kind command in any way: the operator who wrote it already decided.
- A CLI command to edit the visibility cache; the file is documented and hand-editable.
- Changing what `stop` archives: the `renameSync` hand-over and the exactly-once invariant are
  untouched — suppression happens after the archive, before the copy.
- `doctor` diagnostics for the policy (a future need, not this change).

## MODIFIED Requirements

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
gitea.com — unless the machine-local visibility cache (`repo-visibility.json` beside the user
config, keyed by absolute work-tree top) marks that work tree `private`. A work tree with no
remote, a remote on any other host, or a `private` cache mark SHALL keep the default behaviour.
`"on"` SHALL force the copy and `"off"` SHALL force the stand-down, whatever the remotes say. The
decision SHALL be made from local reads only — `git remote -v` and the cache file — and SHALL NOT
make a network call. A suppressed recording SHALL be reported once, prefixed `[set-copilot]`, on
the stream the built-in target's own report uses (stderr for a dictation stop, stdout for a
meeting and back-fill), naming the reason and the offending host, and SHALL NOT be recorded as a
`handover` step in the recovery ledger; the recording stays at its archived path. Back-fill SHALL
count a suppressed recording as deliberately kept — not as unsaved and needing attention — and
SHALL report the suppression once per run rather than once per recording.

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
  report stream names the stand-down and `github.com`, no `handover` step is recorded in the
  recovery ledger, and the archived recording is intact in the runtime dir

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
  and `--check` reports no unsaved recording for them
