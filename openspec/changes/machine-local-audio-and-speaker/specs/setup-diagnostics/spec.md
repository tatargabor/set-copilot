# Spec Delta

## IN SCOPE

- A warning when a git-tracked project config carries a per-machine key.
- `doctor --fix` moving those keys into the user config, printing every move.

- The governing "report, never repair" rule gains its one exception: an explicit `--fix`.

## OUT OF SCOPE

- Running the move automatically (no migration, no hook).
- Editing any other project's config as part of this change.
- The existing device-name finding: unchanged.

## ADDED Requirements

### Requirement: Per-machine keys in a tracked project config are reported and moved on request

The configuration diagnostics SHALL warn when the project config is tracked by git and sets a
per-machine key — any `audio` key or `transcript.speakers.mic` — to a non-empty value, naming
each key and its value and naming `set-copilot doctor --fix` as the corrective action. Where the
user-level config sets the same key to a different value, the finding SHALL say that the project
value is ignored on this machine and name the machine's value. Keys the
device-name finding already reports SHALL NOT be repeated by this finding. An untracked project
config, and a project root that is the user-level config directory itself, SHALL NOT produce this
finding.

`set-copilot doctor --fix` SHALL move the per-machine keys out of the project config without
asking: each non-empty value SHALL be written into the user-level config unless the user-level
config already sets that key to a non-empty value, in which case the project value SHALL be
dropped and the machine's kept; an empty-string value SHALL be removed from the project config;
a section emptied by the move SHALL be removed. Before writing, each file that changes SHALL be
backed up as `<name>.bak`. Every moved, dropped and removed key SHALL be printed with its value
and destination. Without `--fix`, `doctor` SHALL NOT modify either file.

#### Scenario: A tracked project config carrying a speaker label is reported

- **WHEN** the project config is tracked by git and sets `transcript.speakers.mic` to `Alice`
- **THEN** `doctor` warns, naming `transcript.speakers.mic="Alice"` and `set-copilot doctor --fix`

#### Scenario: A project value the machine overrides is called ignored

- **WHEN** the tracked project config sets `audio.sampleRate` to `48000` and the user config sets it
  to `16000`
- **THEN** the finding names `audio.sampleRate=48000` as ignored on this machine, where `16000`
  applies

#### Scenario: An untracked project config is not reported

- **WHEN** the project config sets `audio.sampleRate` but is not tracked by git
- **THEN** no per-machine-key finding is reported

#### Scenario: --fix moves a key the machine does not declare

- **WHEN** `doctor --fix` runs and the project config sets `audio.sampleRate` to `48000` and the
  user config sets no `audio.sampleRate`
- **THEN** the user config gains `audio.sampleRate: 48000`, the project config no longer has it,
  both changed files have a `.bak`, and the move is printed

#### Scenario: --fix never overwrites the machine's value

- **WHEN** `doctor --fix` runs and both configs set `transcript.speakers.mic`, to `Alice` in the
  project and `Bob` in the user config
- **THEN** the user config keeps `Bob`, the project config no longer has `mic`, and the
  dropped project value is printed

#### Scenario: Without --fix nothing is written

- **WHEN** `doctor` runs without `--fix` on a project config carrying per-machine keys
- **THEN** both config files are byte-identical afterwards

## MODIFIED Requirements

### Requirement: A silent precondition SHALL be reported explicitly

Every precondition whose *absence* produces no observable symptom SHALL be reported by the
diagnostics, stated as a precondition rather than inferred from a failure. This is the
governing rule of this capability: a self-gating mechanism (one that exits quietly when it
is not wanted) is indistinguishable, from the outside, from one that is broken — so the
system SHALL name the gate rather than leave the operator to guess.

Diagnostics SHALL report, never repair: no diagnostic SHALL rewrite, migrate, or normalize
a user's configuration or settings as a side effect of being run. The one exception is an
explicit request: `doctor --fix` moves the per-machine keys out of the project config (the
requirement on per-machine keys below), because the operator asked for exactly that change.
Without `--fix`, `doctor` SHALL leave every file byte-identical.

The configuration preflight (`config-resolution-and-migration`) is not a diagnostic and is not
covered by this guarantee: it runs before `doctor` as it runs before every command other than
`init` and `help`, and it applies a pending schema migration — rewriting a config file and leaving
a `.bak` — before any diagnostic reads the files. What `doctor` then reports describes the files as
they stand after that migration.

#### Scenario: A quietly self-gating mechanism is named

- **WHEN** diagnostics run against a feature that no-ops silently when a precondition is
  unmet
- **THEN** the report SHALL state the precondition and whether it is currently met, rather
  than reporting only the observable outcome (which is identical to "working, but nothing
  to do")

#### Scenario: Diagnostics never repair

- **WHEN** diagnostics detect a stale, drifted, or ineffective configuration, and `--fix` was not
  given
- **THEN** they SHALL report it with the corrective action, and SHALL leave every
  configuration and settings file byte-identical

#### Scenario: A pending migration is applied by the preflight, not by doctor

- **WHEN** `doctor` runs in a project whose config file predates config versioning
- **THEN** the preflight migrates and stamps the file and reports the rewrite before `doctor`
  starts, and `doctor`'s own checks change nothing further
