## 1. Pure diagnostics module

- [ ] 1.1 Create `src/diagnostics.ts` with the finding type: a `{ level: "info" | "warn", message, fix? }` shape, so a caller can render without re-deciding severity (D1).
- [ ] 1.2 Derive the known-key set from `DEFAULTS` recursively (one level into the nested sections) and add an explicit `EXTRA_KNOWN_KEYS` for supported keys with no default (`knowledge.adapter`, `wall.categoriesModule`, …) (D2).
- [ ] 1.3 Implement `diagnoseConfig(raw, { envRuntimeDir, hasWall })` over already-parsed config objects: unknown keys by name, declared-vs-effective keyword counts via the real `normalizeKeywords` (D3), missing `wall` section as `info`, and `runtimeDir` overridden by env as `info` naming the winner.
- [ ] 1.4 Implement `diagnoseMirror({ hookCommands, scriptExists, markerExists, wallRunning, runtimeDir })` returning the three states separately plus the corrective action for each, never a single verdict.
- [ ] 1.5 Implement `stopHookRegistered(settings, scriptBasename)` matching the basename in any `hooks.Stop[].hooks[].command`, tolerant of a malformed object (returns "unknown", never throws) (D4).

## 2. Tests for the pure layer

- [ ] 2.1 `src/diagnostics.test.ts`: keywords declared 15 / effective 0 (the real 2026-07-28 `set-promo` value) reports both counts and the expected shape.
- [ ] 2.2 Unknown key by name; a config with only known keys yields no finding.
- [ ] 2.3 `runtimeDir` in file + env set → one `info` finding naming env as the winner; env unset → no finding.
- [ ] 2.4 Missing `wall` section is `info`, never `warn`.
- [ ] 2.5 Hook detection: project-scope command string, global-scope command string, a wrapped command, absent, and a malformed `settings.json` — five cases, per D4.
- [ ] 2.6 `diagnoseMirror` covers marker+wall present but hook missing (the field case), all three present, and none present.
- [ ] 2.7 Guard test for D2: every config key `loadConfig` reads is in the derived set ∪ extras — with a comment that weakening this test silently narrows the checker.

## 3. Collector + `doctor` integration

- [ ] 3.1 Add a thin collector (file reads: both config paths + mtimes, both `settings.json` paths, hook script existence, marker existence, `wall.pid` liveness) — file access only, no diagnosis (D1).
- [ ] 3.2 Resolve the reported runtime dir exactly as capture does (`SET_COPILOT_DIR` → config → default) and print it in the mirror section (D7).
- [ ] 3.3 Render a config section in `runDoctor`: paths + mtimes always, findings below; a healthy config prints one line. Findings must NOT touch the exit code (D5).
- [ ] 3.4 Render the mirror-readiness section: three states, each with its own outcome, plus the runtime dir.
- [ ] 3.5 Add `doctor --mirror`: skips the audio probes, prints only the mirror section, exits non-zero when the hook is not registered (D5/D6).

## 4. `init` drift report

- [ ] 4.1 In `cmdInit`, when the config file already exists, run the collector + `diagnoseConfig` and print the findings after the "left untouched" line; assert by inspection that no write path is added.
- [ ] 4.2 Report "no drift found" explicitly when there are no findings, so the healthy case is also an answer.

## 5. Skill gate

- [ ] 5.1 In `skills/meeting-copilot/SKILL.md`, make the `mirror` branch run `doctor --mirror` before writing `wall-mirror.enabled`, and write the marker only on success.
- [ ] 5.2 On failure, the skill reports the CLI's own message (which names the install command) and does not claim mirroring is enabled.
- [ ] 5.3 Note in the skill that the gate is hook registration only — the wall may legitimately not be running yet at enable time (D6).

## 6. Verify

- [ ] 6.1 `npm run build` clean under `tsc` strict; `npm test` green.
- [ ] 6.2 Run `set-copilot doctor` against `~/code2/set-promo` (the project that failed) and confirm it reports: stale mtime, missing `wall` section, keywords 15→0, `runtimeDir` overridden, and hook not registered.
- [ ] 6.3 Run `set-copilot doctor --mirror` in the same project and confirm a non-zero exit with the install command in the message; then in this repo (hook installed) confirm exit 0.
- [ ] 6.4 Confirm no config or `settings.json` file was modified by any of the above (`git status` + mtime check on the user-level files).
