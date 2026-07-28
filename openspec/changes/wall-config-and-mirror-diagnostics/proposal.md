## Why

Two live meetings degraded silently on 2026-07-28, and in both cases the machine
*could* have said so. Evidence in `docs/wall-field-backlog.md` §A1–A2, verified against
the project that ran the wall:

- `set-promo/set-copilot.config.json` is dated 2026-07-13, has **no `wall` section**,
  pins `"runtimeDir": "/tmp/set-copilot"` (which the `/ds`, `/dd` and `/meeting-copilot`
  skills override with a session-scoped `SET_COPILOT_DIR` anyway), and lists its
  `knowledge.keywords` as a flat array of **plain strings**. That last one is not merely
  stale: `normalizeKeywords` (`src/config.ts:686`) keeps only entries with a `topic` +
  `stems`, so all 15 configured keywords resolve to **zero** — silently. The operator's
  reading, *"init nélkül is régi volt a config, ezért nem tudtuk a régi JSON fájlra
  beállítani az új megjelenítést"*, is correct, and nothing in `doctor` or `init` reports
  any of it. `init` on an existing config prints exactly `• … already exists — left
  untouched` (`src/cli.ts:236`).
- The chat→wall mirror could not have run: the project has no `.claude/hooks/`, no `Stop`
  entry for `wall-mirror.sh` in the project or user `settings.json`, and no
  `wall-mirror.enabled` marker in any runtime dir. The hook is *both* opt-in (marker) and
  self-gating (silent exit, `hooks/wall-mirror.sh:29-33`), so each of the two failure
  modes is independently invisible — and from the wall they are indistinguishable.

That is the blind spot of hook enforcement: the enforcement is real, its **absence** is
silent. This change adds no new mechanism and rewrites none — it makes the existing
preconditions *observable* before a meeting starts.

## What Changes

- **Config diagnostics in `doctor`.** A new report section that reads the actual config
  files (user + project) and names what it finds wrong, each with the fix:
  - keys that no schema version knows (typo / removed key),
  - `knowledge.keywords` in a shape that normalizes to zero entries — reported with the
    count that survived, because "configured 15, effective 0" is the whole story,
  - a missing `wall` section on a project that has a wall (i.e. the defaults are in force
    and no project layout/box/redaction config exists),
  - a `runtimeDir` in the config while `SET_COPILOT_DIR` is set — stated as "overridden,
    the config value is dead", not as an error,
  - config file mtime, so "how old is this?" is answerable at a glance.
- **Mirror readiness in `doctor`**, as three independent states rather than one verdict:
  Stop hook registered (project or user `settings.json`, and the script present)? ·
  `wall-mirror.enabled` marker set for the session's runtime dir? · a wall running for
  that dir? Each answered separately, because the operator's next action differs per
  state.
- **`init` reports drift instead of only "left untouched".** When a config already
  exists, run the same diagnostics over it and print them, so the one command a user runs
  to set up a project is also the one that tells them the setup rotted.
- **The `mirror` start path fails loudly.** `/meeting-copilot … mirror` verifies the Stop
  hook is registered before writing the marker, and refuses-with-instructions when it is
  not, rather than creating a marker that can never fire.
- Non-goals, stated so review can hold them: the hook mechanism, the marker protocol, the
  config resolution order, and the redaction fallbacks are **unchanged**. Nothing here
  auto-migrates or rewrites a user's config; diagnostics report, the user decides.

## Capabilities

### New Capabilities
- `setup-diagnostics`: what `doctor`/`init` must observe and report about a project's
  effective configuration and its chat→wall mirror readiness, including the rule that a
  precondition whose absence is silent must be reported explicitly.

### Modified Capabilities
- `chat-mirror`: the mirror's enable path gains a precondition — the Stop hook must be
  verifiable as registered before the `wall-mirror.enabled` marker is written, and a
  missing hook is a loud, instructive failure rather than a silent no-op.

## Impact

- `src/doctor.ts` — new config + mirror report sections (currently audio/creds only).
- `src/cli.ts` — `cmdInit` calls the diagnostics on an existing config;
  `registerStopHook` gains a read-only "is it registered?" counterpart.
- `src/config.ts` — a diagnostics-facing view of the raw files (known-key set, per-file
  paths and mtimes, effective-vs-configured keyword count). The resolution order itself
  does not change.
- `skills/meeting-copilot/SKILL.md` — the `mirror` branch checks hook registration before
  writing the marker.
- Tests: pure-logic only, per the project rule — key/shape/keyword-count diagnosis and
  hook-registration detection are unit-testable; the audio probes stay CLI-verified.
