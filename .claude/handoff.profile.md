# Handoff profile — <project name>

> Read by the `/handoff` skill (`set-claude-handoff`). **Project-owned**: `init` creates it once
> and never overwrites it, so a skill upgrade cannot clobber your probes.
>
> Everything below is a starting point. Delete what does not apply — a probe that measures
> nothing is worse than no probe, because it makes the measurement look thorough.

## What "state" means here

<One paragraph. What does "where do I stand" mean in this repo? A green test suite? Which
document is written, committed, and sent? How far a migration got? Write it for someone who has
never seen the project — that is exactly who the successor is.>

## Probes

Commands worth running here when writing a handoff. **Only the relevant ones** — the skill does
not run all of them blindly.

| command | what it tells you | expect |
|---|---|---|
| `<your test command>` | is the suite green | `N passed`, 0 failed |
| `<your build command>` | does it build | exit 0 |
| `<your deploy/status command>` | did it ship | the deployed revision |
| `git log --oneline -5 -- <area>` | what went into this area | — |
| `ls -lt <generated output dir>` | when we last generated | — |

⚠ Write the **expectation** next to each. A number with nothing to compare it against is not a
measurement.

## Never lose

Things that live outside git and would vanish **silently** on a `/clear` — the successor cannot
discover they existed. List them itemised in §1 of the handoff.

- `<gitignored runtime scratch, e.g. .set/…>` — <what is in it, whose it is>
- untracked drafts / freshly written notes
- <anything else this project keeps outside version control>

## Parallel sessions

Which paths typically belong to another thread, so §6 ("what not to touch") can be filled in
honestly. If parallel sessions do not happen here, write that.

## Template extras

Optional. Extra columns or sections the handoff skeleton should carry in this repo. Examples:

- add a `client / partner` column to the §1 table
- in §4, separately mark what is **already at the client** — the successor must not rewrite it
- a warning about a repo rule the successor could break unknowingly

Leave empty if none.
