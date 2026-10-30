## ADDED Requirements

### Requirement: init scaffolds the config and the machine's secret file

Besides the skills, `init` SHALL write a config file from the package's example config — into the
project root, or with `--global` into the user-level config directory — and SHALL leave an existing
config file untouched (reporting its drift, per `setup-diagnostics`). It SHALL write a `.env` into
the user-level config directory, containing an empty `SONIOX_API_KEY=` line and readable by the
owner only (mode `0600`), unless one already exists there, in which case it SHALL leave it
untouched. The secret lives once per machine, not per project, so dictation works from any working
directory; a project `.env` still overrides it (`config-resolution-and-migration`).

#### Scenario: A fresh project

- **WHEN** `init` runs in a project with no config file and a machine with no user-level `.env`
- **THEN** the project gets `set-copilot.config.json` copied from the example, and the user-level
  config directory gets a `.env` with mode `0600` holding an empty `SONIOX_API_KEY`

#### Scenario: Existing files are never overwritten

- **WHEN** `init` runs where both the config file and the user-level `.env` already exist
- **THEN** both are left byte-identical and the output says so

### Requirement: --global installs for every working directory

With `--global`, `init` SHALL install the skills into the user-wide Claude Code skills directory
(`~/.claude/skills`), the hooks into `~/.claude/hooks`, register hooks in `~/.claude/settings.json`,
and write the config into the user-level config directory — so `/ds` works from any working
directory. Without it, the same artifacts SHALL go into the project's `.claude/` directory and the
project root.

#### Scenario: A global install

- **WHEN** `init --global` runs
- **THEN** the skills are installed under `~/.claude/skills` and the config file is written into the
  user-level config directory, not into the working directory

### Requirement: init installs the shipped hooks and keeps their registration current

`init` SHALL copy the package's `hooks/` directory into the target `.claude/hooks`, and SHALL
reconcile the `Stop` hook registrations in the target `settings.json`, preserving every other
setting and hook:

- it SHALL remove every `Stop` hook whose command invokes the retired `wall-mirror.sh`, matched by
  script name, dropping a hook group only when the removal empties it, and say so — the chat→wall
  mirror is now a follower process (`mirror-follower`), and a surviving registration would
  double-emit every line next to it;
- it SHALL register the `recovery-guard.sh` `Stop` hook once — referenced through
  `$CLAUDE_PROJECT_DIR` for a project install and by absolute path for `--global` — and on a re-run
  SHALL leave an existing registration as it is and report that.

A `settings.json` that is not valid JSON SHALL be left untouched, with a warning, rather than
overwritten: a user's hook configuration is not something to lose to a parse error.

#### Scenario: The retired mirror hook is removed

- **WHEN** `init` runs where `settings.json` registers a `Stop` hook invoking `wall-mirror.sh`
  alongside other hooks
- **THEN** that registration is removed, the other hooks remain, and the output names the removal

#### Scenario: The recovery guard is registered once

- **WHEN** `init` runs twice in the same project
- **THEN** `settings.json` holds exactly one `Stop` hook invoking `recovery-guard.sh`, and the second
  run reports it as already registered

#### Scenario: A malformed settings file is preserved

- **WHEN** the target `settings.json` is not valid JSON
- **THEN** it is left byte-identical and a warning names it

### Requirement: An archived skill directory cannot register as a skill

When `init` archives an installed real directory to `<name>.bak-<timestamp>` before linking, it
SHALL rename the archive's `SKILL.md` to `SKILL.md.bak`. An archive left with its `SKILL.md` intact
is still a skill directory in the skills folder, and would surface as a second skill competing with
— or shadowing — the one just installed.

#### Scenario: The archive holds no live SKILL.md

- **WHEN** `init` replaces an installed real `meeting-copilot` directory with a link
- **THEN** the archived `meeting-copilot.bak-<timestamp>` directory contains `SKILL.md.bak` and no
  `SKILL.md`
