# Spec Delta

## IN SCOPE

- `init` registers the `recordings-check.sh` `SessionStart` hook once.

## OUT OF SCOPE

- Removing or changing any other hook registration.
- Registering anything for an already-initialised project without a re-run of `init`.

## MODIFIED Requirements

### Requirement: init installs the shipped hooks and keeps their registration current

`init` SHALL copy the package's `hooks/` directory into the target `.claude/hooks`, and SHALL
reconcile the hook registrations in the target `settings.json`, preserving every other
setting and hook:

- it SHALL remove every `Stop` hook whose command invokes the retired `wall-mirror.sh`, matched by
  script name, dropping a hook group only when the removal empties it, and say so — the chat→wall
  mirror is now a follower process (`mirror-follower`), and a surviving registration would
  double-emit every line next to it;
- it SHALL register the `recovery-guard.sh` `Stop` hook once — referenced through
  `$CLAUDE_PROJECT_DIR` for a project install and by absolute path for `--global` — and on a re-run
  SHALL leave an existing registration as it is and report that;
- it SHALL register the `recordings-check.sh` `SessionStart` hook once, referenced the same way, and
  on a re-run SHALL leave an existing registration (matched by script name) as it is and report that.

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

#### Scenario: The recordings check is registered once

- **WHEN** `init` runs twice in the same project
- **THEN** `settings.json` holds exactly one `SessionStart` hook invoking `recordings-check.sh`, and
  the second run reports it as already registered
