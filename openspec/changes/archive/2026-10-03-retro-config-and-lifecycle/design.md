# Design

## Context

A retro-spec (see proposal.md — Why). The specs describe the committed code at `HEAD`; the working
tree's uncommitted `src/cli.ts` / `src/config.ts` edits (project registry) are out of scope. Every
claim was checked against the source and, where it is cheap to observe, by running the `HEAD` CLI
against a scratch project with `SET_COPILOT_HOME` set.

## Goals / Non-Goals

**Goals:** a spec for every behaviour of config resolution/migration, process lifecycle and audible
feedback that a caller can observe today, with the reason it exists taken from the commit history.

**Non-Goals:** fixing anything. Where the code's comments or help text claim more than the code
does, the spec follows the code and the gap is listed below, to be fixed by a normal change.

## Decisions

- **Reference, don't restate.** Transcript archival is `meeting-transcript-persistence`, event-log
  rotation is `wall-scroll-replay`, the stop-time mirror drain is `mirror-follower`. The lifecycle
  spec owns only the claim/refuse/reclaim rules, `--detach`, the stop wait, `status` and `path`.
- **The preflight is not a diagnostic.** `setup-diagnostics` promised "diagnostics never repair",
  while the preflight rewrites configs before `doctor` runs. Rather than leave two specs in
  conflict, the requirement is MODIFIED to say where the guarantee's boundary lies; every base
  scenario is carried forward unchanged.
- **Census items dropped because the code does not do them:** `doctor` dry-running the migration
  (`runConfigPreflight` has a `dryRun` option and a comment naming `doctor` as its user, but no
  caller passes it), and `doctor` continuing past an unparseable config (see below).

## Risks / Trade-offs

Gaps found while verifying, deliberately NOT specified:

- [An unparseable config kills `init`, `help` and `doctor` with a stack trace] → `cli.ts:79` calls
  `loadConfig()` for the `--detach` check before dispatch (added in 2835e5d), so the preflight's
  exemptions for `init`/`help` and its "doctor keeps going" intent (`cli.ts:71-76`) are unreachable
  unless `SET_COPILOT_DIR` is set. Fix in a change: resolve the runtime dir only for `capture`/`wall`.
- [A missing player binary crashes the caller] → `playTone` spawns `paplay`/`afplay` with no
  `error` listener; the `try/catch` cannot catch the asynchronous ENOENT, so on a machine without
  the player the capture dies when its microphone connects (reproduced with a nonexistent binary).
  `notify`'s fallback spawn has the same shape.
- [Help text is stale] → `beep` is described as "start: single, --end: double"; it plays the
  rising/falling motifs (the double bell is only the unsupported-platform fallback).
- [init's next steps contradict the device rule] → step 2 tells the user to put `audio.micSource`
  into the config `init` just wrote — the project config for a non-global install — which the
  diagnostics then warn about.
- [Misleading preflight report] → a user config the migration *creates* is reported with
  "previous state: <path>.bak", but no backup exists for a file that did not exist.
- [`stop` chimes on a stale PID file] → the silence rule keys on the PID file's presence, so a
  `capture.pid` left by a killed capture still produces the stop tone. Specified as is.
