## Why

`set-copilot init` installs the skills by **copying** them, so the installed copy drifts from its
own source and nothing reports it. Measured 2026-08-09 on this machine, where the package is
`npm link`ed to this very checkout: `~/.claude/skills/meeting-copilot/SKILL.md` is 16 437 B
(2026-07-23) against a 31 107 B source (2026-07-30) — **~15 KB that never reached a session**,
including the entire mirror section, and today's `/meeting-copilot` ran from that oldest copy.
`set-repair` and `transcript-recover` were never installed at all, while init's message names all
six. Worse than stale: the installed `dd`/`dictate` still carry the "concatenate the `text` fields"
instruction that CLAUDE.md documents as the *cause* of dictation corruption (`…a ide, ameetingek…`),
so every `/dd` today ran the known-broken instruction.

The second half is the reason a project keeps its own copy at all: a project-specific transcript
handover has nowhere to live in the shared skill, so consumer-a forked `meeting-copilot` (28 115 B)
rather than lose it — and a fork of a skill that already silently drifts is the same failure twice.
Measured 2026-07-30: six transcripts stayed unhanded under `.set/copilot/`, the largest 18 500 words.

## What Changes

- **A checked-out repo becomes the source, not a snapshot of it.** When the package runs from a git
  checkout, `init` **symlinks** `<skills-dest>/<name>` at `<repo>/skills/<name>`; from
  `node_modules` (an npm install, where there is no newer source to track) it keeps copying.
- **The installer says which mode it is in**, and what each entry points at. The silent-drift
  failure inverts otherwise: "why is my fix not taking effect?"
- **A dangling link is refused, not created.** The target's existence is verified; a link whose
  target has gone missing is reported and replaced, because a dangling symlink makes the skill
  vanish from the list with no error anywhere.
- **An existing real directory is archived, never deleted** — `<name>.bak-<timestamp>`, mirroring
  the transcript and wall-log hand-over rule already in force.
- **The installer reports the names it actually installed**, derived from what it wrote, replacing
  today's hardcoded six-name list that reported work it had not done.
- **New: `copilot.handoverCommand`** — a project command that `stop` runs after the handover
  completes, so a project-specific transcript hand-off (consumer-a:
  `node scripts/copilot-handover.mjs --slug <topic>`) no longer requires forking the skill. It is
  not fatal to the handover: the archive is the invariant.
- **The general half of consumer-a's forked skill moves into the package**: the reasoned `--print`
  ban, the fragment warning (the raw `.jsonl` holds flush fragments, so post-processing reads the
  `.md`), what the three printed paths mean, and that handover runs after `stop`.

Not breaking: an npm-installed package behaves exactly as today, and a config without
`handoverCommand` runs the handover it runs today.

## Capabilities

### New Capabilities
- `skill-installation`: where `init` puts the skills and how an installed skill stays identical to
  its source — install mode (link vs copy) and its declaration, dangling-target refusal,
  archive-don't-delete, and truthful reporting of what was installed.

### Modified Capabilities
- `meeting-transcript-persistence`: adds the configurable post-handover project command
  (`copilot.handoverCommand`), and extends what the stop flow tells the operator about the
  artifacts (the `--print` ban and why, and that the raw JSONL is fragments so downstream work
  reads the `.md`).

## Impact

- `src/cli.ts` — `cmdInit` (the skills loop, ~277–292) and its reporting.
- `src/config.ts` — the `copilot.handoverCommand` seam and its default (absent).
- The stop path (`src/capture.ts` / the stop command) — runs the command after archival, reports
  its outcome, never fails the handover on it.
- `skills/meeting-copilot/SKILL.md` — absorbs the general half of the project fork.
- `set-copilot.config.example.json`, README/CLAUDE.md notes on install mode.
- Downstream, in order: package → install → only then consumer-a deletes its fork. Reversed, the
  knowledge exists nowhere for a while.
