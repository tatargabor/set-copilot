## ADDED Requirements

### Requirement: A silent precondition SHALL be reported explicitly

Every precondition whose *absence* produces no observable symptom SHALL be reported by the
diagnostics, stated as a precondition rather than inferred from a failure. This is the
governing rule of this capability: a self-gating mechanism (one that exits quietly when it
is not wanted) is indistinguishable, from the outside, from one that is broken — so the
system SHALL name the gate rather than leave the operator to guess.

Diagnostics SHALL report, never repair: no diagnostic SHALL rewrite, migrate, or normalize
a user's configuration or settings as a side effect of being run.

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
