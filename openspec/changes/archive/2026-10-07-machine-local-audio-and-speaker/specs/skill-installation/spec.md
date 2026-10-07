# Spec Delta

## IN SCOPE

- Project-mode `init` writes the example config without its `audio` section.

## OUT OF SCOPE

- `--global` init: the example config, `audio` included, still goes into the user config.
- Moving keys out of an existing project config (that is `doctor --fix`).

## MODIFIED Requirements

### Requirement: init scaffolds the config and the machine's secret file

Besides the skills, `init` SHALL write a config file from the package's example config — into the
project root, or with `--global` into the user-level config directory — and SHALL leave an existing
config file untouched (reporting its drift, per `setup-diagnostics`). A config written into the
project root SHALL NOT contain the `audio` section: every `audio` key is per-machine
(`config-resolution-and-migration`), and a scaffolded empty `audio` block in a committed file is
both a git-conflict source and the placeholder that once replaced a machine's microphone. With
`--global` the `audio` section SHALL be written, because there the target is the machine's own
config. It SHALL write a `.env` into the user-level config directory, containing an empty
`SONIOX_API_KEY=` line and readable by the owner only (mode `0600`), unless one already exists
there, in which case it SHALL leave it untouched. The secret lives once per machine, not per
project, so dictation works from any working directory; a project `.env` still overrides it
(`config-resolution-and-migration`).

#### Scenario: A fresh project

- **WHEN** `init` runs in a project with no config file and a machine with no user-level `.env`
- **THEN** the project gets `set-copilot.config.json` written from the example without its
  `audio` section, and the user-level config directory gets a `.env` with mode `0600` holding an
  empty `SONIOX_API_KEY`

#### Scenario: Existing files are never overwritten

- **WHEN** `init` runs where both the config file and the user-level `.env` already exist
- **THEN** both are left byte-identical and the output says so

#### Scenario: A global init keeps the audio section

- **WHEN** `init --global` runs on a machine with no user-level config file
- **THEN** the user-level config file is written from the example with its `audio` section
