# Proposal

## Why

The built-in hand-over target (`docs/inputs/copilot/`) was built so a project that configured
nothing still keeps what was said. That default assumes the repository is **internal**. For a
repo whose remote is a public host, the same default silently copies every dictation and meeting
transcript into a tree a `git push` publishes — the recording-handover survey (2026-10-07) found
recordings that had *no* copy and fixed that; this is the opposite failure: a copy the speaker
never meant to publish. A dictated instruction is the most private artefact the tooling produces,
and it is written into the work tree by default.

Whether a repo is public cannot be asked over the network at stop time: a stop must not block on
a API call, and a stop that fails open on a network error would publish exactly when the network
is down. The decision has to be **deterministic and offline-first**, with an explicit operator
override for the case the rule cannot see (a private repository on a public host).

## What Changes

- New config key `copilot.defaultHandover: "on" | "off" | "auto"` (default `"auto"`). `"auto"`
  is the rule below; `"on"`/`"off"` override it in either direction.
- In `"auto"`, the built-in target **stands down** when the work tree has a git remote on a
  known public hosting host (github.com, gitlab.com, codeberg.org, bitbucket.org, sr.ht,
  framagit.org, gitea.com) **and** the machine-local visibility cache does not mark that work
  tree private. A repo with no remote, a remote on any other host (a company GitLab, an IP), or
  a cache mark of `private` keeps the default behaviour.
- The visibility cache is `repo-visibility.json` beside the user config (the `projects.json`
  precedent): `{"<absolute work-tree top>": "private"}`, read advisory (absent or corrupt = no
  marks), never committed.
- **A configured per-kind command is never gated** — `copilot.handoverCommand` /
  `copilot.dictationHandoverCommand` are deliberate project knowledge; the operator who wrote
  them already decided where recordings go.
- When suppressed, the hand-over reports once, on the stream that stop's reporting already uses
  (stderr for a dictation, stdout for a meeting and back-fill), names the reason and the host,
  and leaves the recording at its archived path — the `renameSync` invariant is untouched. No
  `handover` step is recorded in the recovery ledger, because nothing was handed over.
- **No network call during stop**: the decision reads `git remote -v` and one local JSON file.
  Back-fill counts a suppressed recording as deliberately kept, not as unsaved needing
  attention, and reports the suppression once per run rather than once per recording.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `meeting-transcript-persistence`: "A recording with no configured command persists to the
  built-in target" gains the stand-down rule, the override key, and the reporting/counting
  behaviour when suppressed. All seven base scenarios carry forward unchanged.

## Impact

- `src/recording-store.ts`: remote-host reading and the visibility cache (injected I/O, pure
  decision), beside the built-in-target facts it already owns.
- `src/handover.ts` (`runRecordingHandover`): the stand-down check in the default-target branch —
  the one seam both kinds and back-fill already go through.
- `src/recording-backfill.ts`: suppressed recordings counted separately (neither handed over nor
  failed, exit 0 when nothing else failed), one summary line.
- `src/config.ts`: the `copilot.defaultHandover` key (default `"auto"`, invalid value warns and
  falls back, like `validHandoverCommand`).
- Skills: one sentence each in `set-repair` (kept recordings are expected state on a suppressed
  repo, and the fix is the cache mark or the config key, not a hand copy), `meeting-copilot` and
  `dd` (the stand-down line means kept — report it, do not retry).
- README: the new key and the `repo-visibility.json` cache (path, shape, advisory on corrupt).
- Tests: `src/recording-store.test.ts` (or a new `handover-policy.test.ts`), `src/handover.test.ts`,
  `src/recording-backfill.test.ts`, `src/config.test.ts`.
