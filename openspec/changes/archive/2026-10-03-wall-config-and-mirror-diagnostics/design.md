## Context

`doctor` today answers exactly one question — "can this machine record?" — and answers it
the hard way, by probing the real audio chain. Everything else about a project's setup is
unobserved. Two field failures on 2026-07-28 (`docs/wall-field-backlog.md` §A1–A2) came
from that gap, and both were diagnosable from files already on disk:

- `loadConfig` (`src/config.ts:719`) resolves defaults → user file → project file → env and
  never reports what it dropped. `normalizeKeywords` (`:686`) skips any entry lacking
  `topic`/`stems`, so a flat list of bare strings resolves to zero keywords with no output
  at all. `readConfigFile` (`:671`) throws on malformed JSON but says nothing about
  unknown keys.
- The mirror has two independent gates: the `Stop` hook registration
  (`registerStopHook`, `src/cli.ts:165`, installed by `cmdInit` at `:219-227`) and the
  `wall-mirror.enabled` marker written by the skill. The hook script itself exits silently
  when either the marker or `wall.pid` is missing (`hooks/wall-mirror.sh:29-33`). Nothing
  reads back whether the hook is registered.

Constraint from CLAUDE.md that shapes the whole design: tests cover pure logic only, and
anything touching the PID lifecycle or audio is verified by running the CLI. So the
diagnosis has to be separable from the file access.

## Goals / Non-Goals

**Goals:**
- Make the two silent preconditions observable *before* a meeting, from a command the
  operator already runs.
- Give the mirror enable path a real gate, so an unfirable opt-in cannot be recorded as
  success.
- Keep the diagnosis pure and unit-tested; keep file/OS access in a thin collector.

**Non-Goals:**
- No change to config resolution order, the hook mechanism, the marker protocol, or the
  redaction fallbacks.
- **No auto-migration.** Nothing rewrites a user's config or settings. Findings carry the
  corrective action; the user runs it.
- No new config surface — diagnostics are not configurable.
- Not a schema validator. The aim is the handful of drifts that silently changed behavior,
  not exhaustive validation.

## Decisions

### D1 — Pure analyzers + thin collector, mirroring `transcript-build` / `transcript-stitch-run`

`src/diagnostics.ts` holds pure functions over already-read values: raw config objects,
parsed settings JSON, and booleans for "file exists" / "wall running". `src/doctor.ts` and
`src/cli.ts` do the reading. This is the split the project already uses for the stitch
(pure `transcript-build.ts`, file-facing `transcript-stitch-run.ts`), and it is what makes
the whole capability testable under the "pure logic only" rule.

*Alternative rejected:* diagnostics that read files themselves. Simpler to call, untestable
under the project's test policy, and it would have to be exercised by CLI runs — exactly
what the rule exists to avoid.

### D2 — The known-key set is derived from `DEFAULTS`, with an explicit extras list and a test that ties them together

An unknown-key check needs a list of known keys, and a hand-maintained list rots — which
would make the drift detector itself a source of drift. So the set is derived from the
`DEFAULTS` object shape (recursively, one level into the known nested sections), plus a
small explicit `EXTRA_KNOWN_KEYS` for supported keys that legitimately have no default
(`knowledge.adapter`, `wall.categoriesModule`, and any sibling). A unit test asserts that
every key `loadConfig` actually reads appears in the derived set ∪ extras — so adding a
config key without teaching the diagnostics fails the test, not a user's meeting.

*Alternative rejected:* a JSON Schema. It would be authoritative, but it is a second source
of truth for the config shape and a dependency; the derived set cannot disagree with the
defaults it is derived from.

### D3 — Report `declared` vs `effective` counts by calling `normalizeKeywords`, never a second parser

The keyword finding is "you configured N, the engine got M" and it is produced by running
the real `normalizeKeywords` over the raw value and comparing against a shallow count of
what was declared. Re-implementing the shape rules in the diagnostic would let the
diagnostic and the engine disagree — the one failure mode a diagnostic must not have.

The same principle generalizes: **every effective-value finding is produced by the code
that computes the effective value.** No diagnostic re-derives behavior.

### D4 — Hook detection matches the script filename, not the exact command string

`cmdInit` registers two different command strings depending on scope — `bash
"$CLAUDE_PROJECT_DIR/.claude/hooks/wall-mirror.sh"` for a project, `bash
"<home>/.claude/hooks/wall-mirror.sh"` for `--global` (`src/cli.ts:219-221`) — and a user
may have wrapped it. Matching the full string would report "not registered" for a working
global install, and a false negative here is worse than a false positive: it would send an
operator to reinstall something that already works. Detection therefore looks for the
script's basename in any `hooks.Stop[].hooks[].command`, across **both** the project and
the user settings file, and the report names *which* file it was found in.

The corresponding read-only function sits next to `registerStopHook` and shares its
tolerance for a malformed `settings.json`: a parse error yields "unknown", never a crash
and never a false "missing".

*Alternative rejected:* exact-string equality (brittle across scopes); executing the hook
to see what happens (a self-gating no-op tells you nothing — that is the original problem).

### D5 — Config findings are advisory and never change `doctor`'s exit code; `doctor --mirror` is a gate and does

`doctor` exits 1 to mean "you cannot record" — the audio/credential probes own that
signal, and diluting it would make the exit code useless in scripts. A drifted config does
not stop a recording, so config findings print with `⚠`/`•` and leave the exit code alone.

`doctor --mirror` is a different contract: a targeted, fast (no audio probe) readiness
check whose non-zero exit means "the thing you asked about is not ready". That is what
makes it usable as the skill's precondition gate.

### D6 — The skill gates on the CLI, because the skill is a prompt

`skills/meeting-copilot/SKILL.md` currently writes the marker directly
(`: > "$SET_COPILOT_DIR/wall-mirror.enabled"`). It will run `doctor --mirror` first and
write the marker only on success, reporting the CLI's own instruction otherwise. Mechanics
stay in the CLI; the skill keeps only the sequencing — consistent with "skills are prompts,
not code."

Note the ordering subtlety: at enable time the wall may legitimately not be running yet, so
the gate is on **hook registration** only. The other two states are reported, not required.

### D7 — Runtime dir for the mirror report is the one capture would use

The marker and `wall.pid` are scoped to the runtime dir, and a mismatch between the dir the
operator thinks is in play and the one the skill exported is itself a known cause of "the
mirror does nothing". The report therefore resolves the dir exactly as capture does
(`SET_COPILOT_DIR` → config → default) and **prints it**, so a scope mismatch is visible
rather than being the invisible cause of a puzzling "not enabled".

## Risks / Trade-offs

- **Diagnostic noise → operators stop reading.** → One section, findings only (a healthy
  config prints a single line), each finding one line plus its fix. No finding is emitted
  for drift that changes nothing.
- **False "hook not registered" for a manual/wrapped install.** → D4's basename match
  across both settings files; and the message is phrased as "not found in project or user
  settings", naming where it looked, rather than asserting the hook does not exist.
- **A hand-maintained extras list (D2) rots anyway.** → The test in D2 is the mitigation:
  it fails on an untaught key. If that test is ever weakened, the check silently narrows —
  worth a comment at the test.
- **`doctor --mirror` becomes a gate that blocks a legitimate manual setup.** → It gates on
  hook registration only (D6), the least ambiguous of the three states, and its message
  names the exact install command.
- **Scope creep into a general config validator.** → Held by the Non-Goals: only findings
  that silently changed observed behavior in the field earn a check.

## Migration Plan

Purely additive: new reports, one new flag, one new pure module, one skill step. No config
or settings file is written by this change, so there is nothing to roll forward or back
beyond reverting the commit. Existing `doctor` output and exit semantics are unchanged
(D5), so any script consuming them keeps working.

## Open Questions

- Should `doctor` gain a `--config`-only flag too (fast, no audio probes), symmetric with
  `--mirror`? Deferred until someone wants it; the full run already prints the section.
- Whether the `runtimeDir`-is-overridden finding should eventually become a hard warning at
  capture start as well. Out of scope here — capture's behavior is unchanged.
