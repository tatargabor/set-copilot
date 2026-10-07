# setup-diagnostics Specification

## Purpose
Make every silent precondition of the setup visible: a configuration report that names drift,
unknown keys and dead settings in each config file that participates in resolution, and a
chat-mirror readiness report that answers hook registration, opt-in marker and running wall as
separate states. Diagnostics report and name the corrective action; they never repair.

## Requirements

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

### Requirement: Configuration diagnostics report drift and dead settings

The system SHALL provide a configuration report covering every config file that
participates in resolution (user-level and project-level), and SHALL identify, for each:

- its path and last-modified time, so "how old is this?" is answerable at a glance;
- keys the current schema does not know, listed by name;
- a `knowledge.keywords` value whose declared entry count and *effective* (normalized)
  entry count differ, reported as both numbers;
- the absence of a `wall` section, when the project uses a wall — stated as "defaults are
  in force", not as an error;
- a `runtimeDir` set in the file while the environment overrides it, stated as the config
  value being dead rather than as a conflict to resolve.

Each finding SHALL carry the corrective action. A finding SHALL NOT be reported as a
failure when the resolved behavior is correct — drift that changes nothing is informational.

#### Scenario: Keywords that normalize to nothing

- **WHEN** a project declares `knowledge.keywords` in a shape that yields zero entries
  after normalization (for example a flat list of bare strings rather than
  `{topic, stems}` objects)
- **THEN** the report SHALL state both the declared count and the effective count of `0`,
  and name the expected shape — because a resolved-to-zero list is otherwise
  indistinguishable from an unconfigured one

#### Scenario: An unknown key is named, not silently ignored

- **WHEN** a config file contains a key the current schema does not recognize
- **THEN** the report SHALL list that key by name, so a typo or a removed setting is
  visible instead of being dropped in resolution

#### Scenario: A config value the environment overrides

- **WHEN** a config file sets `runtimeDir` and the environment also sets the runtime
  directory
- **THEN** the report SHALL show both, and SHALL state that the environment wins and the
  config value has no effect

#### Scenario: Missing wall configuration is informational

- **WHEN** a project has no `wall` section in any config file
- **THEN** the report SHALL state that built-in wall defaults are in force, and SHALL NOT
  report it as a failure

### Requirement: Chat-mirror readiness is reported as independent states

The system SHALL report chat→wall mirror readiness as separate, independently observable
states rather than a single verdict, because the operator's next action differs per state:

- whether the `Stop` hook is registered (in the project or user settings) and its script
  is present on disk,
- whether the session's opt-in marker is set for the runtime directory in question,
- whether a wall is running for that same runtime directory.

The report SHALL name the runtime directory it evaluated, since the marker and the wall are
scoped to it and a mismatch there is itself a common cause of "the mirror does nothing".

#### Scenario: Hook missing while the operator believes mirroring is on

- **WHEN** the opt-in marker is set and a wall is running, but no `Stop` hook is registered
  and no hook script is installed
- **THEN** the report SHALL state that mirroring cannot fire, identify the missing hook as
  the cause, and name the command that installs it

#### Scenario: Every state answered separately

- **WHEN** mirror readiness is reported
- **THEN** each of hook registration, opt-in marker, and running wall SHALL be shown with
  its own outcome, and the runtime directory they were evaluated against SHALL be named

#### Scenario: Fully ready

- **WHEN** the hook is registered, its script exists, the marker is set, and a wall is
  running for that runtime directory
- **THEN** the report SHALL state that mirroring is active, with no corrective action

### Requirement: Project setup reports drift on an existing configuration

When project setup runs against a configuration file that already exists, it SHALL run the
configuration diagnostics over that file and print the findings, instead of reporting only
that the file was left untouched. The file SHALL still be left untouched.

#### Scenario: Setup over a stale config

- **WHEN** setup runs in a project whose config file already exists and has drifted
- **THEN** setup SHALL leave the file unchanged AND print the same findings the
  configuration diagnostics would report

#### Scenario: Setup over a healthy config

- **WHEN** setup runs in a project whose existing config has no findings
- **THEN** setup SHALL report that the file was left untouched and that no drift was found

### Requirement: A device name pinned in the project config is reported

The configuration diagnostics SHALL warn when the **project** config sets `audio.micSource` or
`audio.monitorSource` to a non-empty value, naming each pinned key and its value, and SHALL name
the corrective action: move the value into the machine's user-level config and delete it from the
project config. A device name names hardware; the project config is the one that is committed and
cloned onto a second machine, where the name resolves to nothing and the capture streams zero bytes
with no error from any layer. The user-level config SHALL never be flagged for a device — that is
where a device belongs — and an empty string SHALL NOT count as a pin, because it means "system
default".

The configuration migration (`config-resolution-and-migration`) moves such a value once, when a
config predates versioning; this finding is what catches a device pinned in the project config
after that.

#### Scenario: A pinned project device is named

- **WHEN** the project config sets `audio.micSource` to a device name, whether or not a user-level
  config file exists yet
- **THEN** the report warns, naming `audio.micSource` and its value, and points at the user-level
  config file as the place for it

#### Scenario: A device in the user config is not a finding

- **WHEN** only the user-level config sets `audio.micSource`, or the diagnostics run with the user
  config directory itself as the project root (so the one file is the machine's)
- **THEN** no device finding is reported

#### Scenario: An empty device string is not a pin

- **WHEN** the project config sets `audio.micSource` to `""`
- **THEN** no device finding is reported

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
