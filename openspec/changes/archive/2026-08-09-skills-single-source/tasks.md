## 1. The install planner (pure, tested)

- [x] 1.1 Create `src/skill-install.ts` with the action model: `link`, `copy`, `archive-then-link`,
      `replace-dangling`, `skip-missing` — each carrying source, destination, and (for an archive)
      the timestamped backup path.
- [x] 1.2 Implement `planSkillInstall({ skillsSrc, skillsDest, names, mode, inspect })` as a pure
      function over an injected filesystem view (`inspect(path) → "missing" | "dir" | "link-ok" |
      "link-dangling"`), so no test needs a real directory. Mode is `"link" | "copy"` (D1).
- [x] 1.3 Implement `resolveInstallMode(pkgRoot, { forceCopy })` — link when `<pkgRoot>/.git`
      exists, copy otherwise; `forceCopy` always wins (D1).
- [x] 1.4 Timestamped archive names reuse the handover stamp format
      (`new Date().toISOString().replace(/[:.]/g, "-")`) so every archive in this project reads the
      same (D4).
- [x] 1.5 `src/skill-install.test.ts`: a checkout links; `node_modules` copies; `--copy` from a
      checkout copies; an existing real directory yields archive-then-link; an existing valid link
      to the same source yields no archive; a dangling link yields replace-dangling; a missing
      source yields skip-missing and never a link.

## 2. The executor and the report

- [x] 2.1 Implement `applySkillInstall(actions)` in the same module — the only place that calls
      `symlinkSync` (with the `"dir"` type argument), `cpSync`, `renameSync`, `rmSync` — returning
      the actions that actually succeeded.
- [x] 2.2 On archiving a real directory, rename its `SKILL.md` to `SKILL.md.bak` inside the backup
      so the archive cannot be picked up as a shadowing skill (Risks, D4).
- [x] 2.3 Rewrite `cmdInit`'s skills loop (`src/cli.ts` ~277–292) to call resolve → plan → apply,
      deleting the `cpSync` loop and the hardcoded six-name message.
- [x] 2.4 Report from the applied actions: the mode, the source directory when linking, the names
      installed, each archive's destination, and every skipped or repaired entry named (D2, D6).
- [x] 2.5 Add `--copy` to `init`'s argument parsing and to its `--help` text.

## 3. `copilot.handoverCommand`

- [x] 3.1 Add `handoverCommand?: string` to `CopilotPromptConfig` in `src/config.ts`, defaulting to
      absent, with the doc comment stating it runs *after* archival and cannot fail the handover.
- [x] 3.2 Add `runHandoverCommand(cfg, paths)` to `src/handover.ts`: shell execution, 60 s limit,
      stdio inherited, env carrying `SET_COPILOT_TRANSCRIPT`, `SET_COPILOT_TRANSCRIPT_MD`,
      `SET_COPILOT_TRANSCRIPT_JSONL`, `SET_COPILOT_DIR`, and `COPILOT_HANDOVER_SLUG` passed through
      when set (D7).
- [x] 3.3 Call it from `handoverAtStop` (`src/cli.ts`) after `stitchAtStop`, never on the `--print`
      (dictation) path — there the text is the user's message, not a document.
- [x] 3.4 Failure (non-zero exit, missing executable, timeout) is reported on stderr and the
      archived path still returned; no throw escapes into the stop flow (D8).
- [x] 3.5 `src/config.test.ts`: the field resolves from project config, is absent by default, and a
      non-string value is dropped with a warning rather than killing the stop.
- [x] 3.6 Add `copilot.handoverCommand` to `set-copilot.config.example.json` with the consumer-a shape
      as the commented example.

## 4. Skill content — the general half of the project fork

- [x] 4.1 (already true in the source — the consumer-a fork wrote it because the INSTALLED copy
      lacked it, which is the drift itself) In `skills/meeting-copilot/SKILL.md`, state in the stop
      flow why `--print` is forbidden
      for a meeting transcript (it replays the whole transcript into the session as if freshly
      spoken).
- [x] 4.2 (already true in the source) State that the raw `.jsonl` holds flush fragments, not sentences, so any post-processing
      reads the readable `.md`.
- [x] 4.3 (already true in the source) Spell out what each of the three printed paths is for (archive of record / readable source
      for knowledge work / sentence-level structured).
- [x] 4.4 Document that a project hand-off runs after `stop` via `copilot.handoverCommand`, and that
      the session may name the topic with `COPILOT_HANDOVER_SLUG=<topic>` on the stop line.

## 5. Verify and hand over

- [x] 5.1 `npm run build && npm test` — clean.
- [x] 5.2 Re-run `set-copilot init --global`; confirm the output declares link mode and its source,
      names six skills, and names each archived directory.
- [x] 5.3 Confirm on disk: all six entries are symlinks into this checkout, `set-repair` and
      `transcript-recover` exist for the first time, and `dd`/`dictate` no longer contain the
      "concatenate the `text` fields" instruction.
- [x] 5.4 Remove the measurement leftover `~/.claude/skills/symlink-proba`.
- [x] 5.5 Tell consumer-a on the bus that the package now carries the general half and is installed —
      this is the signal that unblocks deleting their fork, and only in that order.
- [x] 5.6 Note the install mode in `CLAUDE.md` (a checkout is the source; an npm install copies) so
      the next contributor is not surprised by editing an "installed" file and changing the repo.
