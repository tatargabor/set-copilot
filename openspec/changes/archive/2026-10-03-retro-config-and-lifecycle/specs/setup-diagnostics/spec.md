## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: A silent precondition SHALL be reported explicitly

Every precondition whose *absence* produces no observable symptom SHALL be reported by the
diagnostics, stated as a precondition rather than inferred from a failure. This is the
governing rule of this capability: a self-gating mechanism (one that exits quietly when it
is not wanted) is indistinguishable, from the outside, from one that is broken — so the
system SHALL name the gate rather than leave the operator to guess.

Diagnostics SHALL report, never repair: no diagnostic SHALL rewrite, migrate, or normalize
a user's configuration or settings as a side effect of being run.

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

- **WHEN** diagnostics detect a stale, drifted, or ineffective configuration
- **THEN** they SHALL report it with the corrective action, and SHALL leave every
  configuration and settings file byte-identical

#### Scenario: A pending migration is applied by the preflight, not by doctor

- **WHEN** `doctor` runs in a project whose config file predates config versioning
- **THEN** the preflight migrates and stamps the file and reports the rewrite before `doctor`
  starts, and `doctor`'s own checks change nothing further
