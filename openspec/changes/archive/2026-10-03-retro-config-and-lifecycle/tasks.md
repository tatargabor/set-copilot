# Tasks

Retro-spec: every task verifies existing behaviour at `HEAD` against the cited source (line numbers
are `HEAD`'s; `src/cli.ts` and `src/config.ts` read via `git show HEAD:<path>`). No code changes.

## 1. config-resolution-and-migration

- [x] 1.1 Verify the defaults → user → project → env layer order and the `SET_COPILOT_HOME` / `XDG_CONFIG_HOME` user dir against src/config.ts:370 and src/config.ts:1059-1119 [REQ: Configuration resolves in a fixed layer order]
- [x] 1.2 Verify per-key merging of `knowledge`/`copilot`/`audio`/`detect`/`wall`/`transcript` and empty-string-as-unset in a file's `audio` against src/config.ts:924-932 and src/config.ts:1065-1088 (tests: src/config-audio-merge.test.ts) [REQ: Nested sections merge key by key, audio included]
- [x] 1.3 Verify `MIC_SOURCE`/`MONITOR_SOURCE` resolve with `??` and `.env` loading tests `=== undefined` against src/config.ts:1138-1139 and src/config.ts:397 [REQ: A device environment variable set but empty means "no device"]
- [x] 1.4 Verify the Soniox key is read only from `process.env`, project `.env` before user `.env`, against src/config.ts:402-405 and src/config.ts:1119 [REQ: The Soniox API key comes only from the environment]
- [x] 1.5 Verify the preflight gate skips only `init`/`help` and reads one file when project root = user dir against src/cli.ts:74-76 and src/config-preflight.ts:57-68 [REQ: The config preflight runs before every command except init and help]
- [x] 1.6 Verify invalid JSON and non-object roots are fatal with the file named and nothing written against src/config-preflight.ts:36-49 and src/config-preflight.ts:69-78; observed by running `status` at HEAD on a trailing-comma config (exit 1, file named) [REQ: An unreadable config stops the run]
- [x] 1.7 Verify version stamping, `.bak` before write, idempotence and no conjured files against src/config-migrate.ts:132-157 and src/config-preflight.ts:82-94 (tests: src/config-preflight.test.ts) [REQ: Pending migrations apply themselves, with a backup]
- [x] 1.8 Verify the v1 device move — never overwrite the machine's device, empty string skipped, emptied section dropped, user config created only for a moved device — against src/config-migrate.ts:67-123; observed at HEAD (`audio.micSource` moved, `sampleRate` kept, `.bak` written) [REQ: Device names migrate from the project config to the machine's]

## 2. process-lifecycle

- [x] 2.1 Verify the claim refuses a live owner before touching disk, reclaims a stale PID, archives, and records `capture.pid`/`capture.output`/`poll-offset` against src/runtime-dir.ts:41-51 and src/runtime-dir.ts:114-149, release at src/capture.ts:345 (tests: src/runtime-dir.test.ts) [REQ: A runtime dir has exactly one capture owner]
- [x] 2.2 Verify the wall's live-PID refusal, reset-after-check, 20-port walk and `wall.pid`/`wall.url` write and cleanup against src/wall/index.ts:101-175 [REQ: A wall claims its runtime dir through wall.pid and wall.url]
- [x] 2.3 Verify `--detach` for `capture`/`wall` only — own session, pinned `SET_COPILOT_DIR`, `<cmd>.log`, 1.5 s watch, exit 1 with the log tail — against src/detach.ts:19-63 and src/cli.ts:79 [REQ: Long-running commands can outlive the tool call that started them]
- [x] 2.4 Verify SIGTERM + 10 s exit wait before hand-over, and the no-PID-file path still handing over, against src/cli.ts:726-760; observed `stop` at HEAD in an empty dir ("No capture running", "Nothing to hand over") [REQ: Stop ends the capture and waits for its flush]
- [x] 2.5 Verify `wall-stop` SIGTERM, 5 s wait and unconditional `wall.pid`/`wall.url` removal against src/cli.ts:1095-1117 [REQ: wall-stop ends exactly the wall its runtime dir names]
- [x] 2.6 Verify the `status` line uses the claim's liveness rule and `capture.output` against src/cli.ts:1188-1198 and src/handover.ts:26-30; observed at HEAD (`capture: stopped · … dictation.jsonl (0 lines)`) [REQ: status reports the capture state and the file it writes]
- [x] 2.7 Verify the `path` name map and the usage/exit-1 path against src/cli.ts:1202-1219; observed `path runtime` and `path bogus` at HEAD [REQ: path prints a resolved runtime path by name]

## 3. audible-feedback

- [x] 3.1 Verify the rising G5→C6 / falling C6→G5 bell motif against src/tones.ts:42-99 [REQ: Start and stop tones are directional]
- [x] 3.2 Verify the temp-dir cache keyed by `TONE_VERSION` against src/tones.ts:21 and src/tones.ts:42-51 [REQ: Synthesized tones are cached per synthesis version]
- [x] 3.3 Verify an existing custom file wins and a missing one falls back against src/tones.ts:34 and src/config.ts:1141-1142 [REQ: A configured custom sound wins when the file exists]
- [x] 3.4 Verify detached fire-and-forget playback and the terminal-bell fallback against src/tones.ts:27-40 [REQ: Playback never blocks the caller]
- [x] 3.5 Verify the start tone on mic connect and the silent no-PID-file stop against src/capture.ts:201-206 and src/cli.ts:729-737, src/cli.ts:755 [REQ: The tones mark what actually happened]
- [x] 3.6 Verify `beep [--end]` and `notify [--critical]` against src/cli.ts:362-363, src/cli.ts:1228-1235 and src/cli.ts:1242-1252 [REQ: beep and notify expose the feedback to skills]

## 4. setup-diagnostics

- [x] 4.1 Verify the project-pinned device warning (non-empty only, project file only) against src/diagnostics.ts:195-219 and src/doctor.ts:194-205 (tests: src/diagnostics.test.ts) [REQ: A device name pinned in the project config is reported]
- [x] 4.2 Verify the preflight runs before `doctor` with no dry-run and doctor's own checks only read, against src/cli.ts:74-76, src/cli.ts:358-361 and src/doctor.ts:157-165 [REQ: A silent precondition SHALL be reported explicitly]

## 5. skill-installation

- [x] 5.1 Verify config-from-example and the `0600` user `.env`, both left untouched when present, against src/cli.ts:556-575 [REQ: init scaffolds the config and the machine's secret file]
- [x] 5.2 Verify the `--global` destinations against src/cli.ts:518-527 and src/cli.ts:533 [REQ: --global installs for every working directory]
- [x] 5.3 Verify hooks copy, `wall-mirror.sh` unregistration, idempotent `recovery-guard.sh` registration and malformed-settings preservation against src/cli.ts:385-445 and src/cli.ts:533-554 [REQ: init installs the shipped hooks and keeps their registration current]
- [x] 5.4 Verify the archived skill's `SKILL.md` is renamed against src/skill-install.ts:126 and src/skill-install.ts:202-205 [REQ: An archived skill directory cannot register as a skill]
