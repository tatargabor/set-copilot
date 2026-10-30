# Proposal

## Why

This is a **retro-spec**. Configuration resolution and migration, the lifecycle of the
long-running processes, the audible start/stop feedback, and parts of `init` and `doctor`
were shipped through ad hoc commits with no OpenSpec requirement behind them, so today the
committed code is the only source of truth for them. This change writes down what that code
already does — and why, from the commit history — so the next change to any of it can be
proposed against a spec instead of against a reading of `cli.ts`.

## What Changes

- Specs only. **No source code changes.** Every requirement describes behaviour present at the
  current `HEAD`; where the code's own comments claim something the code does not do, the spec
  follows the code and the gap is recorded in `design.md` rather than specified.
- New capability specs for config resolution and migration, process lifecycle, and audible
  feedback.
- A delta to `setup-diagnostics`: the project-pinned device warning, and an explicit statement
  that the migration preflight that runs before `doctor` is not itself a diagnostic.
- A delta to `skill-installation`: what `init` writes besides the skills (config, the machine's
  secret file, hooks and their registration), `--global`, and the neutralised skill archive.

## Capabilities

### New Capabilities

- `config-resolution-and-migration`: the layer order defaults → user → project → environment,
  per-key section merging (audio included), the empty-value semantics of device names, where the
  Soniox key may come from, and the versioned self-applying migration preflight that runs before
  every command except `init` and `help`.
- `process-lifecycle`: runtime-dir ownership by a capture and by a wall (PID claim, refusal,
  stale reclaim), `--detach`, `stop` / `wall-stop`, `status`, and `path`.
- `audible-feedback`: the directional start/stop tones, their cache, custom overrides,
  non-blocking playback, when the tones sound, `beep`, and `notify`.

### Modified Capabilities

- `setup-diagnostics`: ADDED the project-pinned device finding; MODIFIED the "silent
  precondition" requirement to state that the config preflight runs before `doctor` and may
  rewrite a config, which the "diagnostics never repair" guarantee does not cover.
- `skill-installation`: ADDED config/secret scaffolding, `--global`, hook installation and
  registration, and the rule that an archived skill directory cannot register as a skill.

## Impact

- `openspec/specs/` gains three capabilities and two updated ones. No code, CLI surface,
  config schema, or test changes.
- Overlap is referenced, not duplicated: transcript archival and hand-over stay in
  `meeting-transcript-persistence`, wall event-log rotation in `wall-scroll-replay`, and mirror
  draining at stop in the mirror capabilities.
