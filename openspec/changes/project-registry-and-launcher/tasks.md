## 1. Registry core

- [x] 1.1 `src/project-registry.ts`: registry file at `userConfigDir()/projects.json`, load/save via temp-file + rename, advisory posture — absent or corrupt registry reads as empty with a stderr warning `[REQ: Persistent per-user project registry] [REQ: Advisory posture]`
- [x] 1.2 Registry operations: `add` (canonicalize via realpath, upsert by canonical path so a re-add updates instead of duplicating), `remove` (by display name or path, clear error when not found), `list` `[REQ: Project registry CRUD]`
- [x] 1.3 Unit tests: add persists; non-canonical path collapses onto the existing record; remove of unknown name/path errors without mutating; corrupt JSON → empty + warning, exit 0 `[REQ: Project registry CRUD] [REQ: Advisory posture]`

## 2. Discovery

- [x] 2.1 Filesystem scan: depth-limited (3) search for directories containing `.git` under given roots, pruning hidden directories and `node_modules`; directory reading injected so tests need no real tree `[REQ: Discovery scan]`
- [x] 2.2 Claude Code history reader: per `~/.claude/projects/<slug>/` take the newest `*.jsonl`, stream it under a byte cap until the first `cwd` value, keep the project only if that directory exists on disk, recency from the file's mtime; reader injected `[REQ: Discovery scan]`
- [x] 2.3 Merge: dedup by canonical path, sort most-recent-first, skip nonexistent scan roots; `projects.scanRoots` config key with defaults `~/code`, `~/src`, `~/projects`, `~/dev` `[REQ: Discovery scan]`
- [x] 2.4 Unit tests: a project known to both sources appears once; vanished history dir dropped; recency ordering; missing roots skipped; byte cap stops runaway reads `[REQ: Discovery scan]`

## 3. CLI wiring for `project`

- [x] 3.1 `set-copilot project list|add [path]|remove <name-or-path>|scan` in `src/cli.ts` with help text `[REQ: Project registry CRUD] [REQ: Discovery scan]`
- [x] 3.2 Run each verb on Linux against a real directory; confirm advisory warning on a hand-corrupted registry `[REQ: Advisory posture]`

## 4. `set-copilot meeting` launcher

- [x] 4.1 Binary + platform gates: `claudeBin()` probing `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, then PATH (absent → actionable install message); win32 refuses before any probe `[REQ: Platform gate]`
- [x] 4.2 Project resolution in order `--project` argument → most recent `lastUsedAt` → current directory; ambiguous match fails naming the candidates `[REQ: Project resolution]`
- [x] 4.3 Preflight: spawn `doctor` with `cwd` set to the resolved project, stdio passthrough; non-zero exit → show output, start nothing, exit non-zero; zero → proceed (warnings ride along) `[REQ: Preflight gate]`
- [x] 4.4 Spawn: `claude <opening prompt>` with `cwd` = project, stdio inherit; opening prompt `/meeting-copilot start wall`, `--mic-only` → `--lite`, words after `--` appended verbatim; update `lastUsedAt` only after successful spawn; `--dry-run` prints resolution + prompt and starts nothing `[REQ: The session owns the meeting lifecycle]`
- [x] 4.5 Skill-availability check: find a readable, non-dangling `meeting-copilot/SKILL.md` in the project's `.claude/skills/` or the user's `~/.claude/skills/`; on absence refuse naming `set-copilot init [--global]` `[REQ: Preflight gate]`
- [x] 4.6 Unit tests: resolution order and ambiguity; prompt composition for defaults, `--mic-only`, and `--` passthrough; platform-gate refusal; skill check passes for both a symlink and a real file and fails on a dangling link `[REQ: Project resolution] [REQ: The session owns the meeting lifecycle] [REQ: Platform gate] [REQ: Preflight gate]`
- [ ] 4.7 **PENDING — needs a human at a terminal**: interactive `claude` spawn cannot be verified from a non-TTY run (a bounded attempt confirmed the gates fire and left no strays, but the session itself needs eyes). Steps:  `--dry-run` for resolution; real run with doctor passing; real run with audio binary hidden from PATH (preflight blocks, nothing spawns); same verbs run from `dist/` (packaged mode, no tsx) behave identically; after a real meeting, `stop` hands the transcript over exactly once as before `[REQ: Preflight gate] [REQ: The session owns the meeting lifecycle]`

## 5. Docs and green build

- [x] 5.1 README: "Start a meeting" section (one command, what preflight checks, what the session owns), registry + scan usage, macOS first-run mic-permission note
- [x] 5.2 `npm run build` + full `npm test` green; `openspec validate --strict` clean
