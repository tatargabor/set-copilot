# config-resolution-and-migration Specification

## Purpose
Resolve one effective configuration from built-in defaults, the machine's user-level config, the
project's committed config and the environment — with a fixed precedence, per-key merging, and
empty-value semantics that keep a device name a property of the machine — and keep the config files
themselves current: validated and migrated before any command reads them, because a config written
against an older meaning of a key fails silently, and nobody edits a config they believe is correct.

## Requirements
### Requirement: Configuration resolves in a fixed layer order

The system SHALL resolve its configuration from four layers, later layers winning: built-in
defaults, then the user-level config file, then the project config file
(`set-copilot.config.json` in the project root, which is the working directory), then environment
overrides (`SET_COPILOT_DIR`, `SET_COPILOT_LANGUAGE`, `SONIOX_MODE`, `STT_BACKEND`,
`WHISPER_BIN`, `WHISPER_MODEL`, `MIC_SOURCE`, `MONITOR_SOURCE`, `COPILOT_MIRROR`).

The user-level config directory SHALL be `SET_COPILOT_HOME` when that is set, otherwise
`set-copilot` under `XDG_CONFIG_HOME`, otherwise `set-copilot` under `~/.config`.
`SET_COPILOT_HOME` exists so that anything spawning the real CLI — a test suite above all — can
keep the preflight (below) from rewriting the developer's own machine config, which is exactly
what happened the first time the preflight ran.

#### Scenario: The project overrides the machine

- **WHEN** the user config sets `language` to `en` and the project config sets it to `hu`
- **THEN** the resolved `language` is `hu`

#### Scenario: The environment overrides both files

- **WHEN** both config files set `runtimeDir` and `SET_COPILOT_DIR` is set in the environment
- **THEN** the resolved runtime dir is the value of `SET_COPILOT_DIR`

#### Scenario: SET_COPILOT_HOME relocates the user layer

- **WHEN** `SET_COPILOT_HOME` names a directory
- **THEN** the user-level config file and the user-level `.env` are read from that directory, and
  `~/.config/set-copilot` is not consulted

### Requirement: Nested sections merge key by key, audio included

The nested sections `knowledge`, `copilot`, `audio`, `detect`, `wall` and `transcript` SHALL merge
per key across the user and project layers: a project that sets one key of a section SHALL NOT
discard the user layer's other keys in that section. The merge is one level deep; a key's value is
taken whole from the higher layer that sets it.

`audio` SHALL merge per key like every other section. It was the one omission until 2026-08-05,
and a project that declared only `sampleRate` silently discarded the machine's microphone. In the
`audio` section of a config **file**, an empty or whitespace-only string SHALL count as "not set"
rather than as an override: nobody writes `micSource: ""` to mean "use the default" — the key is
empty because it was scaffolded empty. Measured 2026-08-27: a scaffolded
`audio: { micSource: "", monitorSource: "" }` in a project config replaced the machine's audio
block, the capture fell back to a digital input delivering noise, and every dictation in that
project came back empty.

#### Scenario: A project setting one audio key keeps the machine's microphone

- **WHEN** the user config sets `audio.micSource` to a device and the project config sets only
  `audio.sampleRate`
- **THEN** the resolved `audio.micSource` is the user's device and the resolved `sampleRate` is
  the project's

#### Scenario: A scaffolded empty device name does not erase the machine's device

- **WHEN** the user config sets `audio.micSource` to a device and the project config sets
  `audio.micSource` to `""` (or to whitespace)
- **THEN** the resolved `audio.micSource` is the user's device

#### Scenario: A real project value still overrides

- **WHEN** the project config sets `audio.micSource` to a non-empty device name
- **THEN** that device name is resolved

### Requirement: A device environment variable set but empty means "no device"

`MIC_SOURCE` and `MONITOR_SOURCE` SHALL be honoured whenever they are **defined**, including when
defined as the empty string, which SHALL resolve to the empty device name (the system default).
Loading a `.env` file SHALL likewise set a variable only when it is undefined — an empty value
already present counts as set.

This is the escape hatch for a machine whose correct answer is "no device": a device name that is
right on one machine resolves to nothing on another and yields a clean zero-byte capture with no
error. With a truthiness test, `MIC_SOURCE=` fell through to the very value it was set to escape,
and a project `.env`'s deliberate empty was overwritten by the user-level `.env` loaded after it.
(An empty string in a config *file* is different — see the per-key merge requirement.)

#### Scenario: MIC_SOURCE= overrides a configured device

- **WHEN** a config file sets `audio.micSource` to a device and the environment defines
  `MIC_SOURCE` as the empty string
- **THEN** the resolved `audio.micSource` is empty

#### Scenario: A project .env empty is not overwritten by the user .env

- **WHEN** the project `.env` contains `MIC_SOURCE=` and the user-level `.env` contains
  `MIC_SOURCE=some-device`
- **THEN** the resolved `audio.micSource` is empty

### Requirement: The Soniox API key comes only from the environment

The Soniox API key SHALL be read only from the `SONIOX_API_KEY` environment variable, which the
system SHALL populate (without overwriting an already-defined value) from the project `.env`
first and the user-level `.env` second. A key written into either config file SHALL NOT be used:
the project config is committed, and a secret has no business being there.

#### Scenario: The project .env wins over the user .env

- **WHEN** both `.env` files define `SONIOX_API_KEY` with different values and the process
  environment does not
- **THEN** the project `.env` value is used

#### Scenario: A key in a config file is ignored

- **WHEN** a config file contains a Soniox key and no environment source defines `SONIOX_API_KEY`
- **THEN** the resolved key is empty

### Requirement: The config preflight runs before every command except init and help

Before dispatching any command other than `init` and `help` (and the bare invocation, which prints
help), the CLI SHALL run a config preflight over the user-level and project config files: validate
that each existing file parses, then apply any pending schema migration. `init` is exempt because it
creates these files; `help` reads none. When the project root is the user config directory itself,
the file SHALL be read once, as the user layer, so a migration can never move a key onto itself.

#### Scenario: A command is preceded by the preflight

- **WHEN** any command other than `init` or `help` runs
- **THEN** the config files are validated and migrated before the command reads its configuration

#### Scenario: init does not migrate

- **WHEN** `init` runs in a project whose existing config file has no `configVersion`
- **THEN** no config file is rewritten or stamped and no `.bak` is created

### Requirement: An unreadable config stops the run

When an existing config file does not parse as JSON, or parses to something other than a JSON
object (an array, a string, a number, `null`), the preflight SHALL stop the command with a non-zero
exit and a message naming the file and the reason, and SHALL rewrite no file. Everywhere else in
this system a bad config would degrade to defaults; here that means capturing in the wrong
language from the wrong device, which looks like success. A dictation that refuses to start costs
seconds; one that records the wrong thing is gone.

#### Scenario: A trailing comma stops the command

- **WHEN** the project config contains a JSON syntax error and a command such as `capture` runs
- **THEN** the command does not run, the output names the file and the parse error, and the exit
  code is non-zero

#### Scenario: A JSON array is not a config

- **WHEN** a config file parses to a JSON array or scalar
- **THEN** the run stops exactly as for a syntax error

#### Scenario: Nothing is migrated while a file is unreadable

- **WHEN** one config file is unreadable and the other has a pending migration
- **THEN** no file is written and no backup is created

### Requirement: Pending migrations apply themselves, with a backup

The config files SHALL carry a schema version in `configVersion`; a file without it is version 0.
When any existing file is behind the current version, the preflight SHALL apply every pending
migration across the **set** of files (a migration may move a key from one file to another), stamp
each existing file with the current version, and write back every file whose content changed —
copying the original to `<name>.bak` before the first write. Each migration decision and each
rewritten file SHALL be reported on stderr.

A migration SHALL apply itself rather than warn and wait: warn-and-wait leaves the broken state in
place for exactly as long as the user does not read the warning, and the failure it prevents is a
silent one. The preflight SHALL be idempotent: an up-to-date set of files SHALL be neither written
nor backed up. It SHALL never create a config file the user does not have, except where a migration
must give a moved value a home.

#### Scenario: An unversioned config is stamped and backed up

- **WHEN** an existing config file has no `configVersion` and no migration changes its content
- **THEN** it is rewritten with `configVersion` set to the current version, the original is kept
  verbatim at `<name>.bak`, and the rewrite is reported

#### Scenario: A second run writes nothing

- **WHEN** the preflight runs again over files it has already migrated
- **THEN** no file is written and no new backup appears

#### Scenario: No config files, nothing created

- **WHEN** neither the user nor the project config file exists
- **THEN** the preflight creates no file

### Requirement: Device names migrate from the project config to the machine's

The version-1 migration SHALL move `audio.micSource` and `audio.monitorSource` out of the project
config into the user-level config. A device name names hardware: committed to a project config it
wins on every clone — the project layer outranks the user layer — and on a second machine it
resolves to nothing, producing a zero-byte capture with no error from any layer (measured
2026-08-05 bringing a Linux-developed project up on macOS).

The migration SHALL move rather than delete, because on the machine that wrote it the name is
correct. It SHALL NOT overwrite a device the user config already declares — that one matches the
hardware by construction — and in that case SHALL drop the project's value and say so. An empty
device string is not a pin and SHALL be left alone. A project `audio` section emptied by the move
SHALL be removed rather than left as `"audio": {}`; the project's other `audio` keys SHALL be left
in place. When the user config does not exist, it SHALL be created to receive the moved device.

#### Scenario: A pinned project device moves to the machine

- **WHEN** an unversioned project config sets `audio.micSource` to a device and the user config
  declares no microphone
- **THEN** after the preflight the project config has no `audio.micSource`, the user config has
  that device, and both files are stamped with the current version

#### Scenario: The machine's own device is never overwritten

- **WHEN** an unversioned project config sets `audio.micSource` to one device and the user config
  already sets it to another
- **THEN** the user config keeps its device, the project's value is removed, and the decision is
  reported

#### Scenario: The project's other audio keys stay

- **WHEN** the project config's `audio` section holds a device name and `sampleRate`
- **THEN** only the device name moves, and `sampleRate` remains in the project config

#### Scenario: An empty device string is not migrated

- **WHEN** the project config sets `audio.micSource` to `""`
- **THEN** the migration does not move it and does not create a user config for it
