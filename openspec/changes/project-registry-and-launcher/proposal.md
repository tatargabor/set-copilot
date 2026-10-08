## Why

The copilot works, but only for the person who assembled it: every meeting starts with a hand-built ritual (open a terminal in the right project, run `/meeting-copilot start wall`, hope the audio chain is up). The productization research (2026-09-07) concluded the shippable form is an installer + launcher around the unmodified Claude Code binary — and its first slice is the front door: know which projects exist, and start a meeting in one command. macOS and Linux are both in scope from day one (the user's explicit requirement); capture already works on both.

## What Changes

- **`set-copilot project`** — a persistent, per-user registry of known projects (`list` / `add` / `remove`), stored next to the existing user config. Minimal records (path, name, addedAt, lastUsedAt); advisory by construction, like the recovery ledger: a missing or corrupt registry never blocks anything, and a project never *needs* registration.
- **`set-copilot project scan`** — discovery of candidate projects: merge a depth-limited scan for `.git` roots under configurable roots (default: common code dirs) with the project history Claude Code already keeps under `~/.claude/projects/` (decoded to real paths, existing ones only, recency-ranked), deduplicated by realpath.
- **`set-copilot meeting`** — the one-command front door: resolve the project (`--project` argument > registry last-used > current directory), run the existing `doctor` as a preflight, then spawn `claude` in the project directory with the `/meeting-copilot start wall` opening prompt. The launcher is the **front door, not the lifecycle owner** — capture, wall and mirror stay started and stopped by the session exactly as today, preserving every runtime-dir invariant (single owner, exactly-once handover).
- **Cross-platform (mac + linux)** — both new verbs work on both platforms from the same code path; on unsupported platforms (win32) `meeting` refuses up front with an actionable message instead of failing mid-preflight.
- **Local capability preserved, packaged parity required** — the change is purely additive: every hand-run flow (`/ds`, `/dd`, `/meeting-copilot start`, running from a checkout with symlinked skills) keeps working byte-identically, because the launcher only composes existing commands. The packaged direction is served, not contradicted: the new verbs must behave identically whether set-copilot runs from a checkout or a global install, and `meeting` verifies the meeting-copilot skill is actually discoverable (project or user skills directory) before spawning, pointing at `set-copilot init` when it is not.
- Out of scope, deliberately: the local web setup wizard, Tauri shell, bootstrap installers, Windows capture, GLM presets — later slices of the productization roadmap.

## Capabilities

### New Capabilities
- `project-registry`: persistent per-user registry of known copilot projects — CRUD verbs, discovery scan (filesystem + Claude Code history), advisory failure posture, config-driven scan roots.
- `meeting-launcher`: the `set-copilot meeting` command — project resolution order, doctor-based preflight gate, spawning the Claude Code session with the meeting-copilot opening prompt, platform gate, and the invariant that the launcher never owns the runtime dir.

### Modified Capabilities

<!-- None: capture, wall, poll, stop and the skills keep their current behavior. -->

## Impact

- **New code**: `src/project-registry.ts` (registry + discovery — pure logic where possible), `src/meeting.ts` (resolution, preflight, spawn). CLI wiring in `src/cli.ts`.
- **Config seam**: a `projects.*` config section (scan roots) — config, not code, per the house rule.
- **Untouched on purpose**: `capture`, `stop`, `poll`, the wall, and every `skills/*/SKILL.md` — the launcher composes existing commands and must keep them byte-identical.
- **Tests**: registry CRUD/merge, discovery merge + dedup + recency, project-resolution order — all pure logic. Preflight and spawn paths verified by running the CLI on Linux and macOS.
- **Docs**: README + a short "start a meeting" section; the productization research lives in the conversation/report, not the repo.
