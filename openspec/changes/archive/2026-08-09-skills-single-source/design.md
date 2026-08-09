## Context

`cmdInit` (`src/cli.ts`, the skills loop around 277–292) does one thing per skill: `cpSync`. That
was right when the only way to get the package was `npm i`, and wrong the moment the same machine
also *develops* it — which is the normal case here, where the global binary is `npm link`ed at this
checkout (`set-copilot@0.1.0 -> ~/code/set-copilot`). A copy taken from a directory that keeps
moving is a snapshot nothing refreshes and nothing reports.

Two facts constrain the design, both measured rather than assumed:

- **Claude Code follows a symlink.** Verified 2026-08-09: `~/.claude/skills/symlink-proba` pointed
  at a directory outside any repo and the skill appeared in the list without a session restart. So
  linking is available, not hypothetical.
- **A same-named global skill shadows the project one.** Verified the same day: the harness reported
  `Base directory: ~/.claude/skills/meeting-copilot` while a project copy existed. This is
  why the fix must land at the *global* install; patching a project copy is silently inert.

The handover half is a different shape of the same problem. consumer-a forked the skill (28 115 B)
because its transcript hand-off — lifting the file out of the gitignored runtime dir into the
project's inputs — had nowhere else to live. A fork of a skill that already drifts silently is the
same failure twice, so the fork only dissolves if the package grows the seam.

## Goals / Non-Goals

**Goals**
- An edit to `skills/<name>/SKILL.md` in a checkout is, with no second step, what the next session
  reads.
- The install mode is never a guess: the run says which one it used and what it points at.
- Nothing the operator had at the destination is destroyed to get there.
- A project-specific hand-off runs at stop without forking the skill.

**Non-Goals**
- Changing how an npm-installed package behaves. `node_modules` has no newer source to track, so it
  keeps copying, byte for byte as today.
- A skill *updater* / drift *detector*. Linking removes the drift rather than reporting it; the
  copy path is left as-is (and now says so, which is the honest fix for a mode that can drift).
- Windows support beyond what already exists. `symlinkSync(..., "dir")` is passed the type argument
  so a future Windows run is not silently broken, but the audio chain is POSIX-only regardless.

## Decisions

### D1 — The mode is decided by the package's own location, not by the destination

`init` links when `PKG_ROOT/.git` exists, copies otherwise.

`.git` is direct evidence of a working copy that can move ahead of the install. Its absence covers
both remaining cases correctly: a `node_modules` install and an extracted tarball each have no
tracking source, so a copy is the *right* answer, not a fallback.

Rejected: sniffing for `node_modules` in the path. It answers a narrower question ("was this npm
installed?") than the one that matters ("is there a source that will move?"), and it misreads a
checkout that happens to live under a `node_modules` ancestor.

Deciding from the destination — "it is already a link, so keep linking" — was rejected outright: it
makes the mode sticky to whatever the last run did, which is exactly the un-inspectable state this
change exists to remove.

`--copy` forces the copy path from a checkout, for the operator who wants a frozen install.

### D2 — The declaration is part of the install, not a verbose flag

Every run prints the mode and, for links, the source directory they resolve to. The failure this
prevents is symmetric and neither half announces itself: under copy, an edit to the source never
reaches a session; under link, an edit to the "installed copy" silently edits the repo. One line of
output is the whole defence, so it is unconditional.

### D3 — A dangling link is the one failure that must never be created

A symlink whose target is gone makes the skill disappear from the list with no error at any layer —
indistinguishable from never having installed it. So the target is verified before linking, and an
existing entry that is a dangling link is replaced and reported (never left, never counted as
installed).

### D4 — Replace by archiving, on the rule this repo already runs on

An installed real directory becomes `<name>.bak-<timestamp>` before a link takes its place, using
the same `new Date().toISOString().replace(/[:.]/g, "-")` stamp as `handoverTranscriptOnce`. The
transcript archive and the wall event log already say the same thing: *rename, never destroy.* An
operator who hand-edited an installed skill gets that edit back; without the archive it is gone with
no trace that it existed.

A link being replaced by an equivalent link is not archived — a link holds no content.

### D5 — The planner is pure; only the executor touches the disk

A new `src/skill-install.ts` exposes `planSkillInstall(state) → actions[]` (link / copy / archive+link
/ skip-missing / replace-dangling) and an `applySkillInstall(actions)`. The repo's test rule is that
vitest covers pure logic and the CLI is verified by running it; a planner returning a list of
intended actions puts D1–D4 — the part that is judgement — inside that boundary, and leaves only
`symlinkSync`/`cpSync`/`renameSync` outside it.

`cmdInit` keeps orchestrating and reporting; the report is rendered **from the applied actions**,
which is what makes D6 true by construction rather than by discipline.

### D6 — The report is derived, never a literal

Today's `console.log` names all six skills from a string literal. Measured the same day: it printed
that list while two of the six were absent from the destination. A message describing work rather
than reporting it is worse than no message — it is the reason the drift went unnoticed for weeks. So
the names come from the actions that actually ran, and a skipped skill is named as skipped.

### D7 — `copilot.handoverCommand` gets its context through the environment, not through placeholders

The command is a string, run through the shell after archival and stitching, with the paths exported
as `SET_COPILOT_TRANSCRIPT`, `SET_COPILOT_TRANSCRIPT_MD`, `SET_COPILOT_TRANSCRIPT_JSONL`, and the
runtime dir as `SET_COPILOT_DIR`.

Placeholder substitution (`{transcript}`) was rejected: the values are file paths, substitution into
a shell string is a quoting bug waiting for the first space in a path, and the project's script has
to parse them back out of `argv` anyway.

The one value stop cannot know is the meeting's topic — consumer-a wants `--slug <topic>`, and the
topic is the *session's* knowledge, not the capture's. So stop passes through
`COPILOT_HANDOVER_SLUG` from its own environment when set; the skill runs
`COPILOT_HANDOVER_SLUG=<topic> set-copilot stop`, and the project's script reads it. No new syntax,
and the session keeps naming what only it knows.

### D8 — The command cannot fail the handover

Non-zero exit, missing executable, or exceeding a 60 s limit is reported on stderr and the archived
path is still returned. This is the same posture `stitchAtStop` already takes, for the same reason
stated there: the `renameSync` is the invariant; everything after it is convenience. A project
script that throws must not be able to make a meeting look unhanded.

Its stdout and stderr are forwarded rather than captured, so the project's own report (where the
transcript landed) reaches the operator instead of vanishing into a buffer.

## Risks / Trade-offs

- **A link makes the installed skill editable in place — and that edit is a repo edit.** Accepted:
  it is what "the checkout is the source" means, and D2's declaration is what keeps it from being a
  surprise. The alternative (a copy) is the defect being fixed.
- **`.bak-<timestamp>` directories accumulate** in `~/.claude/skills/`. Accepted: they are created
  only on a mode transition, are named for what they are, and the alternative is deleting an
  operator's edit. Note they are *directories under the skills root*, so a stray `SKILL.md` inside
  one could in principle be picked up as a skill; the backup name is deliberately not a valid skill
  layout (`<name>.bak-<stamp>/SKILL.md` carries the original `name:` frontmatter and would shadow —
  so the archive is written with its `SKILL.md` renamed to `SKILL.md.bak`, and tasks cover it).
- **`handoverCommand` runs arbitrary configured shell.** It is read from the project's own
  `set-copilot.config.json` — the same trust level as `knowledge.adapter`, which already loads a
  project-supplied module. No new trust boundary; noted so it is not later mistaken for one.
- **Ordering with consumer-a is external to this repo.** The fork must not be deleted before the
  package carries its general half and is installed. The tasks state the order; nothing in code can
  enforce it.

## Migration Plan

1. Land the code and the skill content; `npm run build`.
2. Re-run `set-copilot init --global` on this machine. Expect: link mode declared, four existing
   real directories archived, six skills installed, `set-repair` and `transcript-recover` present
   for the first time.
3. Verify the session sees them (`/dd` and `/dictate` must now carry the plain-text handover
   wording, not the "concatenate the `text` fields" instruction).
4. Only then does consumer-a delete its forked `meeting-copilot`.

`~/.claude/skills/symlink-proba` (the measurement's leftover) is removed at the end.

## Open Questions

None blocking. One deliberately deferred: whether `init` should also link the *hooks* directory on
the same reasoning. It is the same class of drift, but `recovery-guard.sh` is registered into
`settings.json` by absolute path, so linking it changes what that path means — a separate change,
with its own measurement.
