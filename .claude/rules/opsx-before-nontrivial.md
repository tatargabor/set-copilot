# A behaviour change starts as an OpenSpec change

> Always loaded, so it is short. Since 2026-10-03 OpenSpec leads development here: that
> day every spec had to be resynced to the code (23 written from scratch, 17 corrected),
> because ad hoc feature commits had moved the behaviour and nothing had moved the specs.

## The gate is observable behaviour, not diff size

**A change to what set-copilot does starts as `/opsx:propose`** (or `/opsx:new` /
`/opsx:ff`). Small is fine — a one-requirement change with three tasks is a valid
change. "Behaviour" means anything a user, a skill, or a consumer of the files can
observe: a CLI flag or subcommand, a JSONL field or event, a config key or its meaning,
a wall render, a skill's mechanics, a runtime-dir invariant, an exit code.

**Trivial — no change needed:**

- a typo, a comment, a log wording;
- a pure refactor with no observable change (same output, same files, same exit codes);
- test-only work (new or fixed tests, no `src/` behaviour moved);
- docs only (`docs/`, `README.md`, `CLAUDE.md`) that describes what already exists.

If you are unsure whether something is observable, it is — propose it. When the
requirement itself is unclear, ask first or use `/opsx:explore`; do not guess a scope and
build it.

## The urgent exception has a price

A genuinely urgent direct fix (a capture that loses a dictation, a wall that publishes
what it must not) may go in first. **Its spec delta lands in the same session** — a
change proposed, applied and archived around the fix, or a delta against the affected
`openspec/specs/<capability>/`. "Later" is how the 2026-10-03 drift accumulated.

## Commit trailer

An implementation commit for a change carries, in the **last** paragraph of the message
(next to `Co-Authored-By`, where `git interpret-trailers` looks):

```
OpenSpec: <change-name>
```

The name is the directory under `openspec/changes/` (or its archived copy). One commit
per `/opsx:apply` and one per `/opsx:archive`, as CLAUDE.md says.

Related: `openspec-conventions.md` (how to write the artifacts),
`whole-surface-and-scope.md` (keeping the change the size of the request).
