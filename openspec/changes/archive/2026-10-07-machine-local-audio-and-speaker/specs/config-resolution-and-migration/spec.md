# Spec Delta

## IN SCOPE

- The per-machine keys (every `audio.*` key, `transcript.speakers.mic`) resolve from the user
  config before the project config.
- A project value for those keys still applies on a machine that declares none.

## OUT OF SCOPE

- Any automatic migration of these keys (no new `configVersion` step).
- `transcript.speakers.system` and every other key: they keep "project wins".
- Environment overrides: unchanged, still above both files.

## MODIFIED Requirements

### Requirement: Configuration resolves in a fixed layer order

The system SHALL resolve its configuration from four layers, later layers winning: built-in
defaults, then the user-level config file, then the project config file
(`set-copilot.config.json` in the project root, which is the working directory), then environment
overrides (`SET_COPILOT_DIR`, `SET_COPILOT_LANGUAGE`, `SONIOX_MODE`, `STT_BACKEND`,
`WHISPER_BIN`, `WHISPER_MODEL`, `MIC_SOURCE`, `MONITOR_SOURCE`, `COPILOT_MIRROR`).

The per-machine keys — every key of the `audio` section and `transcript.speakers.mic` — SHALL be
the one exception: for them the user-level config SHALL win over the project config, and a project
value SHALL apply only when the user-level config does not set that key. They describe the local
audio chain and the person at the microphone; committed in the project layer they conflict in git
between machines and silently override every other clone. Environment overrides SHALL still win
over both files for these keys.

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

#### Scenario: The machine's speaker label wins over the project's

- **WHEN** the user config sets `transcript.speakers.mic` to `Bob` and the project config sets
  `transcript.speakers` to `{ "mic": "Alice", "system": "Others on the call" }`
- **THEN** the resolved `mic` label is `Bob` and the resolved `system` label is
  `Others on the call`

#### Scenario: A project speaker label applies on a machine that declares none

- **WHEN** the user config sets no `transcript.speakers.mic` and the project config sets it to
  `Alice`
- **THEN** the resolved `mic` label is `Alice`

### Requirement: Nested sections merge key by key, audio included

The nested sections `knowledge`, `copilot`, `audio`, `detect`, `wall` and `transcript` SHALL merge
per key across the user and project layers: a layer that sets one key of a section SHALL NOT
discard the other layer's other keys in that section. The merge is one level deep; a key's value is
taken whole from the higher layer that sets it — for `audio`, the higher layer is the user config
(see the layer-order requirement).

`audio` SHALL merge per key like every other section. It was the one omission until 2026-08-05,
and a project that declared only `sampleRate` silently discarded the machine's microphone. In the
`audio` section of a config **file**, an empty or whitespace-only string SHALL count as "not set"
rather than as an override, in either layer: nobody writes `micSource: ""` to mean "use the
default" — the key is empty because it was scaffolded empty. Measured 2026-08-27: a scaffolded
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

- **WHEN** the project config sets `audio.micSource` to a non-empty device name and the user
  config sets no `audio.micSource` (or sets it to `""`)
- **THEN** the project's device name is resolved

#### Scenario: The machine's audio value wins over the project's

- **WHEN** the user config sets `audio.sampleRate` to `16000` and the project config sets it to
  `48000`
- **THEN** the resolved `sampleRate` is `16000`

### Requirement: Device names migrate from the project config to the machine's

The version-1 migration SHALL move `audio.micSource` and `audio.monitorSource` out of the project
config into the user-level config. A device name names hardware: committed to a project config it
reaches every clone — on a machine that declares no device of its own the project's applies — and on
a second machine it resolves to nothing, producing a zero-byte capture with no error from any layer
(measured 2026-08-05 bringing a Linux-developed project up on macOS).

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
