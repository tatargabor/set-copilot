# Proposal

## Why

`audio.*` (which microphone and monitor, the sample rate, the start/stop tones) and
`transcript.speakers.mic` (the name printed for the local microphone — a person) are facts about
a machine and the person at it. They live in the committed project config today, and the project
layer outranks the machine's user config, so:

- each machine that commits its own value creates a git conflict with the next machine's
  (reported 2026-10-07: the microphone and speaker label go up to git and conflict with
  another person's machine, or the same person's second machine);
- a value committed from one machine silently wins on every other clone. For a device name that
  was already measured as a 0-byte capture (2026-08-05), which is why device names were moved to
  the user config by migration v1 — but `sampleRate`, the tones and the speaker label were left
  in the project layer, and nothing writes to the user config when a project is set up.

## What Changes

- For the per-machine keys — every `audio.*` key and `transcript.speakers.mic` — the user config
  (`~/.config/set-copilot/set-copilot.config.json`, or `SET_COPILOT_HOME`) wins over the project
  config. A project value still applies on a machine that declares none. Environment overrides
  (`MIC_SOURCE`, `MONITOR_SOURCE`) still win over both.
- `init` (project mode) no longer writes an `audio` section into the project config; with
  `--global` the example config, `audio` included, still goes into the user config. The config
  migration already writes device names to the user config and is unchanged.
- `doctor` warns when a **git-tracked** project config carries a per-machine key, naming each key
  and value.
- `doctor --fix` moves them: each non-empty value goes into the user config unless the machine
  already declares one (then the project value is dropped, the machine's kept), empty
  placeholders are removed, both files are backed up as `.bak` first, and every move is printed.
  It asks nothing. It never runs on its own — only on `--fix`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `config-resolution-and-migration`: the layer order gains the per-machine exception; the audio
  merge's "a real project value still overrides" becomes "applies when the machine declares none";
  the device-name migration's rationale stops claiming the project layer outranks the machine.
- `setup-diagnostics`: a new requirement for per-machine keys in a tracked project config, and
  `doctor --fix`; the governing "report, never repair" requirement gains the explicit `--fix` exception.
- `skill-installation`: `init` scaffolds a project config without the `audio` section.

## Impact

- `src/config.ts` (`loadConfig` merge order for `audio` and `transcript.speakers.mic`),
  `src/config-migrate.ts` (a pure `moveMachineLocalKeys`, not registered as an automatic
  migration), `src/config-preflight.ts` or a sibling writer for `--fix`, `src/diagnostics.ts`
  (the finding), `src/doctor.ts` + `src/cli.ts` (`--fix`), `src/cli.ts` `cmdInit`.
- Tests: `config-audio-merge.test.ts`, `config.test.ts`, `config-migrate.test.ts`,
  `diagnostics.test.ts`.
- Behaviour change for a machine whose user config and project config disagree on an `audio`
  key: the machine's value now wins. On this machine the user config already declares
  `sampleRate: 16000`, equal to every project value seen.
- No other project's config is edited by this change; the mechanism is `doctor --fix`, run by
  whoever owns the project.
- Sibling change `recording-handover` also edits `cmdInit` in `src/cli.ts` and MODIFIES a different
  `skill-installation` requirement; apply order: this change's commit first, then recording-handover's.
- Review: touches `src/`, goes through `/opsx:review`.
