# Tasks

## 1. Per-machine keys resolve from the machine first

- [x] 1.1 Tests first (`src/config-audio-merge.test.ts` / `src/config.test.ts`, with `SET_COPILOT_HOME` pointed at a temp dir): user `audio.sampleRate` 16000 vs project 48000 resolves 16000; project `micSource` applies when the user declares none or `""`; user `speakers.mic` wins while the project's `system` label survives; project `speakers.mic` applies when the user has none. Run against unfixed code and record which fail. [REQ: Configuration resolves in a fixed layer order] [REQ: Nested sections merge key by key, audio included]
- [x] 1.2 In `src/config.ts`: export `MACHINE_LOCAL_KEYS`; resolve `audio` as `mergeAudio(project, user)`; apply a non-empty user `transcript.speakers.mic` over the merged speakers; update the `loadConfig` and `mergeAudio` doc comments and the existing "real project value still overrides" test to the new reading. Verify: `npx vitest run src/config-audio-merge.test.ts src/config.test.ts`. [REQ: Configuration resolves in a fixed layer order] [REQ: Nested sections merge key by key, audio included]

## 2. doctor warns on a tracked project config; --fix moves

- [x] 2.1 Tests first: `moveMachineLocalKeys` (pure, in `src/config-migrate.ts`) on fixtures — move when the user lacks the key, drop when the user declares it, remove `""` placeholders, delete emptied sections, report every action; `diagnoseConfig` with `ctx.projectConfigTracked` true/false produces/omits the finding and does not repeat device names the device finding reports. [REQ: Per-machine keys in a tracked project config are reported and moved on request]
- [x] 2.2 Implement `moveMachineLocalKeys`, the finding in `src/diagnostics.ts` (naming a project value the machine overrides; tracked detection via `git ls-files --error-unmatch` in `collectConfigState`), and `doctor --fix` in `src/cli.ts`/`src/doctor.ts`: run the move before the probes, back up changed files as `.bak`, write, print each action. Verify: unit tests green; CLI run in a temp git repo with `SET_COPILOT_HOME` set — `doctor` warns and leaves both files byte-identical (`sha256sum` before/after), `doctor --fix` moves and prints, a second `--fix` moves nothing. [REQ: Per-machine keys in a tracked project config are reported and moved on request]

## 3. init writes no audio section into a project config

- [x] 3.1 Test first: a pure `withoutMachineLocalKeys` over the shipped example config drops `audio` and keeps every other key. In `cmdInit`, write the example through it in project mode (unchanged with `--global`); point init's next-steps text at the machine config for `audio.micSource`; pass `projectConfigTracked` to init's drift report too. Verify by running `init` in a temp dir with `SET_COPILOT_HOME` set: the project file has no `audio`; `init --global` with a fresh `SET_COPILOT_HOME` writes `audio` into the user config. [REQ: init scaffolds the config and the machine's secret file]

## 4. Docs and whole suite

- [x] 4.1 CLAUDE.md `config.ts` bullet: the per-machine exception to the layer order, and `doctor --fix`. README config section (its example project config carries `audio`), `skills/dictate/SKILL.md` (where `audio.micSource` goes), the device finding's fix text. Run `npm run build && npm test`. [REQ: Configuration resolves in a fixed layer order]

## Evidence (2026-10-07)

- Against unfixed `config.ts`: "the machine's audio value wins" and "the machine's speaker label wins" failed (2 failed, 81 passed); green after.
- CLI, temp git repo with a tracked project config (`audio.sampleRate=48000`, `toneStart=""`, `speakers.mic="Alice"`) and `SET_COPILOT_HOME` holding `speakers.mic="Bob"`: `doctor` warned (naming `Alice` as ignored here) and left both files byte-identical; `doctor --fix` moved `sampleRate`, removed the empty `toneStart`, dropped `Alice` (machine keeps `Bob`), wrote both `.bak`s; a second `--fix` found nothing.
- `init` in a temp dir: project config has no `audio` key.
