# Spec Delta

## IN SCOPE

- A warning when a git-tracked project config carries a per-machine key.
- `doctor --fix` moving those keys into the user config, printing every move.

## OUT OF SCOPE

- Running the move automatically (no migration, no hook).
- Editing any other project's config as part of this change.
- The existing device-name finding: unchanged.

## ADDED Requirements

### Requirement: Per-machine keys in a tracked project config are reported and moved on request

The configuration diagnostics SHALL warn when the project config is tracked by git and sets a
per-machine key — any `audio` key or `transcript.speakers.mic` — to a non-empty value, naming
each key and its value and naming `set-copilot doctor --fix` as the corrective action. Keys the
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
