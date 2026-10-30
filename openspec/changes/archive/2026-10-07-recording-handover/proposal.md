# Proposal

## Why

Recordings get lost, and the loss is silent. A content-hash survey on 2026-10-07 found, on one
machine, 15 dictations in one project and 14 meeting transcripts in another with no copy anywhere
in the repository: they exist only under the gitignored `.set/copilot/<session>/`, where a
worktree swap, a cleanup or a new machine removes them without a trace.

Three gaps produce that:

1. **A project that configures no hand-off keeps nothing.** `copilot.handoverCommand` and
   `copilot.dictationHandoverCommand` are opt-in; absent, the archive stays in the runtime dir.
   One project configured the meeting command only, so every dictation there stayed behind.
2. **A dictation hand-off gets less than a meeting one.** It receives no readable `.md` (only the
   raw fragments), and no command can tell which kind of recording it was given.
3. **Nothing finds what was already lost.** There is no command that compares the runtime dirs
   against the repository, and no session is told that unsaved recordings exist.

The guiding principle (user, 2026-10-07): what matters is that a knowledge-base search or a plain
text search finds a recording wherever it was filed — so the readable `.md` always lands next to
the raw file.

## What Changes

- **One seam, both kinds.** Meeting and dictation stops call the same hand-off function. It passes
  the same environment to a project command — `SET_COPILOT_TRANSCRIPT`, `…_TRANSCRIPT_MD`,
  `…_TRANSCRIPT_JSONL`, `SET_COPILOT_DIR` — plus `SET_COPILOT_KIND=dictation|meeting` and
  `SET_COPILOT_RECORDED_AT`. A dictation stop now also produces the readable `.md` and the
  stitched `.jsonl` beside its archive (reported on stderr, never on stdout).
- **The command per kind keeps its key.** A meeting runs `copilot.handoverCommand`, a dictation
  `copilot.dictationHandoverCommand`, as today (see design D1 for why a meeting-only command does
  not start receiving dictations).
- **A built-in default target.** When the key for that kind is not configured, the stop copies the
  raw `.jsonl`, the readable `.md` and the stitched `.jsonl` into `docs/inputs/copilot/` of the
  git work tree as `<YYYY-MM-DD>-<kind>-part<N>-<sha8>.jsonl` / `.md` / `-stitched.jsonl`. It is
  skipped when a byte-identical copy of the raw file is already present in the work tree (SHA-256
  over tracked and untracked-not-ignored files, `.set/` excluded, never by name), and when nothing
  was said. It never commits; it prints what to commit. A configured command overrides the default
  (a no-op command, `true`, opts out).
- **Back-fill.** `set-copilot backfill` scans this project's `.set/copilot/` for recordings
  (`dictation-*.jsonl`, `transcript-*.jsonl`, and a live-named `transcript.jsonl` /
  `dictation.jsonl` with no capture running), finds those with no content-identical copy in the
  work tree and no successful command hand-off recorded in the project's recovery ledger, stitches
  them, and hands each over through the same seam. `--dry-run` lists without writing; `--check`
  prints one line only when something is unsaved. Idempotent; never commits; records a machine-local
  marker (last run, what was handed over) at `.set/copilot/backfill-last.json`.
- **Session-start check.** `init` registers a `SessionStart` hook (`hooks/recordings-check.sh`)
  that runs `backfill --check`, so a session is told when this machine holds unsaved recordings.

## Capabilities

### New Capabilities

- `recording-backfill`: finding and saving recordings the stop-time hand-off never persisted, the
  machine-local record of what was handed over, and the session-start check.

### Modified Capabilities

- `meeting-transcript-persistence`: the dictation hand-off gets the derived artifacts and the
  meeting's environment, both commands get the kind marker, and an unconfigured kind persists to
  the built-in target.
- `skill-installation`: `init` also registers the `SessionStart` recordings check.

## Impact

- `src/handover.ts` (the seam), a new `src/recording-store.ts` (identity, the default target, the
  ledger step and marker), a new `src/recording-backfill.ts` (scan, classify, run),
  `src/recovery-ledger.ts` (the engine-owned `handover` step), `src/cli.ts` (`stop`, `backfill`, `init`, help), `hooks/recordings-check.sh`,
  `skills/dd/SKILL.md`, `skills/meeting-copilot/SKILL.md`, `skills/set-repair/SKILL.md`, README, CLAUDE.md.
- Consumer projects: a project with both commands configured sees only two new environment
  variables and, on a dictation, two new ones it may ignore (`…_MD`, `…_JSONL`). A project with the
  meeting command only starts persisting dictations into `docs/inputs/copilot/`. A project with
  neither starts persisting both there. Nothing is committed by the engine.
- Every `/dd` in a git work tree now writes up to three files into that tree.
- Spec ordering: `dictation-stitched-output` (active, not archived) MODIFIES the same
  "Handover persists…" requirement. This change carries its text forward and adds a scenario, so
  archiving that change afterwards fails loudly (it would drop the scenario) instead of silently
  reverting this one; its delta must be refreshed before it archives.
- Sibling change `machine-local-audio-and-speaker` also edits `cmdInit` in `src/cli.ts` and MODIFIES a
  different `skill-installation` requirement; apply order: that change's commit first, then this one.
- Review: touches `src/`, `hooks/`, `skills/`; goes through `/opsx:review`.
