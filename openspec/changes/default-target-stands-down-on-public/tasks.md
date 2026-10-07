# Tasks

## 1. The policy: config key, remotes, cache

- [ ] 1.1 `src/config.ts`: `copilot.defaultHandover: "on" | "off" | "auto"`, default `"auto"`; a value that is none of the three warns and falls back to `"auto"` (the `validHandoverCommand` precedent). Verify: `config.test.ts` cases — default, `"off"` honoured, `"on"` honoured, invalid warns and falls back. [REQ: A recording with no configured command persists to the built-in target]
- [ ] 1.2 `src/recording-store.ts`: `remoteHosts(top, io)` reading `git remote -v` through injected I/O, and a host parser handling `https://`, `ssh://`, scp-like `git@host:path` and explicit ports. Verify: unit tests over URL forms. [REQ: A recording with no configured command persists to the built-in target]
- [ ] 1.3 `src/recording-store.ts`: `defaultHandoverSuppressed(cfg, top, io)` — `"off"` → suppressed (config); `"on"` → never; `"auto"` → suppressed iff some remote host is in `PUBLIC_HOSTS` and the cache (`repo-visibility.json` via `userConfigDir()`, advisory load, injected) does not mark `top` private. Returns the reason string (`public remote: <host>` / `copilot.defaultHandover: "off"`) or undefined. Verify: unit tests — public host + no mark; cache `private`; no remote; non-public host; both overrides; corrupt cache. [REQ: A recording with no configured command persists to the built-in target]

## 2. The stand-down at the seam

- [ ] 2.1 `src/handover.ts` (`runRecordingHandover`): in the default-target branch, evaluate the policy first; on suppression report ONE `[set-copilot]`-prefixed line via the existing `report()` (stderr-protected for dictation), naming the reason and the archive path, return `{ via: "default", written: [], skipped: <reason> }`, and record nothing in the ledger. Verify: `handover.test.ts` cases — suppressed (no copy attempted, no ledger entry, one line), config-override `"off"`, cache-`private` still copies, a configured command bypasses the check entirely. [REQ: A recording with no configured command persists to the built-in target]
- [ ] 2.2 `src/recording-backfill.ts`: count suppressed recordings separately (policy consulted once per recording, reported once per run in the summary); `--check` does not count them as unsaved; `--dry-run` lists them with the reason. Verify: `recording-backfill.test.ts` cases — run summary, `--check` silence, dry-run listing. [REQ: A recording with no configured command persists to the built-in target]

## 3. Whole-surface check

- [ ] 3.1 `npm run build && npm test` green. [REQ: A recording with no configured command persists to the built-in target]
- [ ] 3.2 CLI reproduction on a real repo with a github.com remote (documented in the commit): `set-copilot stop` reports the stand-down and writes nothing under `docs/inputs/copilot/`; after marking the work tree `private` in `repo-visibility.json`, a `set-copilot backfill --dry-run` offers the kept recordings. [REQ: A recording with no configured command persists to the built-in target]
