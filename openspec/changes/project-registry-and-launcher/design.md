## Context

The engine already has every building block: `doctor` probes the real audio chain and STT credentials and exits 1 on failure (`doctor.ts:342`); `capture`/`wall`/`stop` are owned by the session per the runtime-dir invariants; `userConfigDir()` (`config.ts:371`) resolves the user-level config directory with `SET_COPILOT_HOME`/`XDG_CONFIG_HOME` overrides; `soxBin()`/`parecBin()` established the probe-known-paths-then-PATH pattern for external binaries. The meeting-copilot skill's Phase 0 derives the runtime dir from `CLAUDE_CODE_SESSION_ID` in every command line it prints — the session scopes itself, and `~/.claude/projects/<slug>/` holds one directory per project Claude Code has opened, with `cwd` recoverable from the session JSONL inside. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- One command (`set-copilot meeting`) from any shell to a running, verified meeting session.
- A registry that survives reboots and answers "which projects exist" without retyping paths.
- Discovery good enough to be useful, cheap enough to run often, and honest about what it cannot decode.
- macOS and Linux through one code path.

**Non-Goals:**
- The launcher owning capture/wall/mirror lifecycle or the runtime dir.
- The web setup wizard, bootstrap installers, Tauri shell (later slices).
- Windows anything (capture unsupported; see roadmap WASAPI item).
- Writing project `set-copilot.config.json` or knowledge sources — the registry stores identity only.
- Dictation (`/ds`/`/dd`) — unchanged.

## Decisions

**D1 — The launcher is a front door, not a lifecycle owner.** `meeting` resolves, preflights, and spawns `claude "/meeting-copilot start wall"` in the project dir with inherited stdio; it starts no runtime process itself. *Alternative considered:* launcher mints the runtime dir and starts capture + wall, then the session joins. Rejected because the skill's Phase 0 derives its own dir from `CLAUDE_CODE_SESSION_ID` in every command, so a launcher-minted dir requires skill edits and splits ownership of the lifecycle across two processes — the exact split the wall docs call out as what makes drawings and transcript point at different places. Front-door keeps every invariant byte-identical and the user-visible outcome the same (the session prints the wall URL seconds later).

**D2 — Registry file: `projects.json` in `userConfigDir()`.** Same resolution as the user config (`SET_COPILOT_HOME` → `XDG_CONFIG_HOME`/`~/.config`), so it is consistent and cross-platform by construction. Shape: `{ version: 1, projects: [{ path, name, addedAt, lastUsedAt }] }`, `path` always canonical (realpath). Writes go through temp-file + rename; reads tolerate absence and corruption (warn on stderr, treat as empty) — the recovery ledger's advisory posture, because a registry that can break a meeting is a registry that shouldn't exist.

**D3 — Discovery reads cwd out of the newest session file, not slug decoding.** Slug decode is lossy — `/` and `.` both become `-`, and real dirs like `-home-user--claude-jobs-…` prove the ambiguity. Instead, per project-history directory: take the newest `*.jsonl`, stream it with a byte cap until the first `"cwd"` value, keep it only if that directory exists on disk; recency from the file's mtime. Merge with a depth-limited (3) scan for `.git` under `projects.scanRoots` (config seam; default `~/code`, `~/src`, `~/projects`, `~/dev` — existing roots only), pruning hidden dirs and `node_modules`. Dedup by realpath; sort most-recent-first. *Alternative:* scan everything under `$HOME` — rejected, cost and noise.

**D4 — Preflight is `doctor`, and its exit code is the gate.** Spawn `doctor` with `cwd` = the resolved project so the project's config and `.env` apply. Exit 0 → launch; exit ≠ 0 → print its output, start nothing, exit non-zero. Doctor already encodes the fatal/warning split this spec needs (warnings like missing BlackHole do not set `failed`), so the launcher adds no judgement of its own — reusing the probe is the whole point.

**D5 — `claude` binary resolution mirrors `soxBin()`.** Probe `~/.local/bin/claude` (native installer), `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, then PATH. Absent → actionable message naming the install command, before any probe runs. Platform gate first: `win32` refuses immediately; `darwin`/`linux` proceed.

**D6 — Usage is recorded only on a successful spawn.** `lastUsedAt` updates after `claude` actually starts, not at resolution or after a failed preflight — a meeting that never happened must not become the resolution target of the next bare `meeting`.

**D7 — CLI shape.** `set-copilot project list|add [path]|remove <name-or-path>|scan`; `set-copilot meeting [--project <name-or-path>] [--mic-only] [-- <extra skill words>]`. Opening prompt is `/meeting-copilot start wall`, with `--mic-only` mapping to the skill's `--lite` mode and `--`-following words appended verbatim. One positional grammar, no sub-configuration flags — the skill owns meeting modes.

**D8 — Local capability is preserved by not touching anything; packaged parity is verified, not assumed.** The local experience (hand-run `/ds`, `/dd`, `/meeting-copilot`, symlinked skills from a checkout) survives because this change ships zero edits to commands the local flows use. The packaged direction adds one preflight check: the launcher looks for `meeting-copilot/SKILL.md` in the project's `.claude/skills/` and the user's `~/.claude/skills/` — existing and non-dangling, since a dangling link makes the skill silently vanish from the session — and on absence refuses with the one command that fixes it (`set-copilot init [--global]`). The check is install-mode-blind on purpose: a checkout's symlink and a global install's copy are equally valid answers, which is exactly what keeps both worlds working with one code path.

## Risks / Trade-offs

- [Doctor's real-signal probe needs a live mic at launch time; macOS may show a first-run mic-permission dialog mid-preflight] → doctor's existing diagnostics name the cause; docs note that the first launch on macOS needs someone at the keyboard once.
- [`~/.claude/projects/` is an untracked internal layout and may change] → extraction is capped, skippable, and advisory; the filesystem scan keeps discovery useful if the layout disappears entirely.
- [Spawning `claude <prompt>` couples the launcher to CC CLI arg semantics] → the prompt is a single argv item of documented usage; a break fails visibly before anything is started, and the fix is one string.
- [Scan cost on large homes] → configured roots only, depth 3, hidden dirs and `node_modules` pruned; scan is an explicit verb, never on a hot path.
- [Concurrent registry writes] → temp+rename single-writer pattern; worst case is a lost `lastUsedAt` update, which is advisory data.

## Migration Plan

Purely additive verbs and one new advisory file (`projects.json`); no existing command, skill, or runtime-dir path changes. Rollback is deleting the verbs; leaving the file behind harms nothing.

## Open Questions

None material. Default scan roots are a starting point by design — config changes them without an engine release.
