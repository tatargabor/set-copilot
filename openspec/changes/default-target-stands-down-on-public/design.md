# Design

## Context

`runRecordingHandover` (`src/handover.ts:105`) is the one seam: it picks the per-kind command or,
absent one, the built-in target (`persistToDefaultTarget`, `src/recording-store.ts:296`). The
config already carries the command keys in the `copilot` section (`src/config.ts:155,176`), and
`recording-store.ts` already owns the git facts the decision needs (`gitToplevel`, `treeNames`
read locally without fetching). The user config dir helper is `userConfigDir()` and
`projects.json` is the precedent for a machine-local advisory JSON beside the user config.

## Goals / Non-Goals

**Goals:**

- Fail safe: the doubtful case suppresses (the recording stays in the gitignored runtime dir,
  recoverable by back-fill once the operator answers), never publishes.
- The stop path stays offline and fast: two local reads, no fetch, no API.
- One decision function, called from the existing seam so `stop` (both kinds) and the back-fill
  run cannot diverge. `--check` and `--dry-run` return before the seam is ever reached, so
  back-fill calls the same function once per invocation — the policy is a property of the work
  tree, not of the recording.

**Non-Goals:**

- Learning actual visibility from the hosting API (network at stop; also fails exactly when it
  matters).
- A CLI to manage the cache; a documented JSON file is enough for now.
- Any change to the project-command path or the archive step.

## Decisions

- **The check lives in `runRecordingHandover`'s default-target branch, not in
  `persistToDefaultTarget`.** The function that copies has no config and cannot report on the
  right stream (a dictation's report is stderr-protected); the seam has both. `persistToDefaultTarget`
  stays a pure copy step and its existing `skipped` results are unchanged.
- **The decision function is pure over injected inputs.** `defaultHandoverSuppressed(cfg, top, io)`
  in `recording-store.ts` takes the remote URL list and the cache contents as arguments (defaults
  read them for real), so the rule is unit-tested without git or a home directory. The host list
  is a module constant; parsing covers `https://`, `ssh://`, scp-like `git@host:path`, ports, and
  `git remote -v`'s `(fetch)`/`(push)` suffixes. A host matches a listed one when it equals it or
  is one of its subdomains — `git.sr.ht` matches `sr.ht` (no sourcehut remote ever appears at the
  bare apex), and `github.company.com` matches `github.com`, suppressing a GitHub Enterprise
  install: the wrong direction there is withheld, not published, and the cache mark or `"on"`
  answers it.
- **The cache key is the canonical top.** `realpathSync` of `git rev-parse --show-toplevel` when
  it exists (the `canonicalProjectPath` precedent), so the path the operator knows — possibly
  behind a symlink — is the key that matches.
- **Only a `private` value in the cache matters.** The rule suppresses on a public-host remote;
  the cache's one job is to answer "this one is actually private". Any other value is ignored —
  there is deliberately no way to mark a private-host repo "public" through the cache, because
  `"on"` already forces the copy explicitly.
- **Corrupt or absent cache = no marks** (advisory, like `projects.json`). A hand-edited file
  that fails to parse must not fail a stop.
- **No ledger record on suppression.** The ledger records hand-overs that happened; recording a
  suppression as a `handover` step would make back-fill treat the recording as saved. Back-fill
  re-evaluates the policy live each run — the check is two local reads, so re-evaluating is free,
  and marking the operator's repo private (or setting the config) takes effect on the next run
  with no stale state to clear. Suppression is also neither `ok` nor `failed` in back-fill's
  counters, and never turns the exit code non-zero on its own: the recordings are kept on
  purpose, so "the next run retries them" would be false and a non-zero exit would read as a
  malfunction to any script wrapping back-fill.
- **Warn once = once per attempt, summarised per back-fill run.** A stop reports its one
  suppression line and finishes; a back-fill run reports the count and reason once in its
  summary. `--check` (the SessionStart hook) does not count suppressed recordings — a public repo
  would otherwise nag at every session start for a condition the operator already chose. The
  dry-run lists them, so the information stays reachable.
- **`"on"` really forces it.** An operator who points a public repo's recordings at the built-in
  target is making the publishing decision deliberately; the engine's job is the default, not a
  veto.

## Risks / Trade-offs

- [A private repo on github.com is suppressed by default] → the report says so and names the
  fix (the cache mark); the recording stays in the runtime dir, and back-fill hands it over the
  moment the mark exists. The wrong direction here is a publish, which is unrecoverable.
- [The host list misses a public host] → a repo on it keeps today's behaviour (copy). The list
  is a constant; extending it is a one-line engine change. Deliberately not config: a list that
  defaults a *safety* behaviour must not be silent per project.
- [A work tree with a public remote used for private forks] → same answer as the private mark.

## Migration Plan

None. The key defaults to `"auto"`; the visible change on a public-host repo is the new report
line and the absence of a copy. Repositories already handed over are content-indexed and stay
deduplicated.
