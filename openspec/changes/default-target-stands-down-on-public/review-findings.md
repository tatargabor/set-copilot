# Review findings — default-target-stands-down-on-public

## Round 1 — 2026-10-07

Reviewers: adversarial-code-reviewer (blind), rules-conformance-auditor (blind)

### Status
| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| M1 | MAJOR | Host-match rule unpinned; exact match fails open for `sr.ht` (real remotes are `git.sr.ht`) | RESOLVED — delta spec + design "host matches when it equals or is a subdomain of a listed one"; tasks 1.2/1.3 |
| M2 | MAJOR | Back-fill counts any `skipped` as failed and exits 1 — the opposite of "deliberately kept" | RESOLVED — delta spec (neither ok nor failed, exit 0) + design "No ledger record" paragraph; task 2.2 restates it |
| M3 | MAJOR | "No skill change" refuted: set-repair, meeting-copilot and dd describe the built-in target's outcomes | RESOLVED — task 2.3 (one sentence each); proposal Impact now lists the skill edits |
| m4 | MINOR | "One decision point" wording doesn't fit `--check`/`--dry-run`, which never reach the seam | RESOLVED — design Goals: one decision FUNCTION, called once per back-fill invocation |
| m5 | MINOR | Cache key "absolute top" vs canonical path precedent (`realpathSync`) | RESOLVED — delta spec + design "The cache key is the canonical top"; task 1.3 |
| m6 | MINOR | "A documented JSON file" — but no task documents it | RESOLVED — task 2.4 (README); the report line now names where the fix lives |

### Findings
#### M1 — exact host match fails open for `sr.ht` (MAJOR)
- **Source:** adversarial-code-reviewer
- **Claim:** The artifacts never say whether a remote host matches a listed one exactly or as a suffix, and `sr.ht` never appears as a bare host — sourcehut remotes are `git.sr.ht` — so the natural exact-match reading leaves sourcehut repos copying to a public repo.
- **Evidence:** proposal host list; tasks.md 1.2 (parsing forms, no matching rule); delta spec host paragraph. No sourcehut remote exists at the apex.
- **Failure scenario:** A speaker on sourcehut dictates; host `git.sr.ht` misses the exact list; the dictation is copied and pushed public — the harm the change exists to prevent, fail-open.
- **Fix:** Pin the rule: equal or subdomain. Test cases for `git.sr.ht`, `gist.github.com`, and the `git remote -v` `(fetch)`/`(push)` suffix. (Correction made while fixing: the reviewer's `github.company.com` example is a different apex, not a subdomain — honest hostname semantics do not match it, and the spec says so with the `"off"` escape; verified by the implemented `hostIsPublic`.)
- **Status:** RESOLVED — delta spec "where a remote's host matches when it equals or is a subdomain of a listed one" + new scenario; design; tasks 1.2/1.3

#### M2 — suppression counts as failed and exits 1 (MAJOR)
- **Source:** adversarial-code-reviewer
- **Claim:** `src/recording-backfill.ts:196` computes `ok = !out.error && !out.skipped`, so a suppressed outcome increments `failed`, prints "N failed — the next run retries them" (false for suppression), and exits non-zero — precisely the "needing attention" reading the requirement forbids.
- **Evidence:** `src/recording-backfill.ts:196,206-207,212`; `src/cli.ts:128`. The delta's back-fill scenario never mentioned the failure count or exit code.
- **Failure scenario:** `set-copilot backfill` on a public-host repo: "0 of 5 — 5 failed", exit 1; wrapping scripts read a malfunction.
- **Fix:** Suppressed is neither `ok` nor `failed`; excluded from the failed sentence; exit 0 when only suppressed remain. Stated in the delta scenario and task 2.2.
- **Status:** RESOLVED — delta spec; design.md; tasks.md 2.2

#### M3 — the skills do describe this path (MAJOR)
- **Source:** adversarial-code-reviewer
- **Claim:** proposal.md said "No skill change", but `set-repair` prescribes `backfill` as the fix for unsaved recordings (a no-op on a suppressed repo, inviting a hand copy that circumvents the gate), and `meeting-copilot`/`dd` enumerate the stop's `[set-copilot]` lines without the new stand-down outcome.
- **Evidence:** `skills/set-repair/SKILL.md:44-48`, `skills/meeting-copilot/SKILL.md:444-450`, `skills/dd/SKILL.md:23-27`.
- **Failure scenario:** `/set-repair` in a public-host repo: the session runs backfill, the recordings stay, and the skill's only visible remedy is hand-copying into `docs/inputs/copilot/` — defeating the gate.
- **Fix:** One sentence in each of the three skills (kept = expected state; the fix is the cache mark or the config key; do not retry). Mechanics → SKILL.md is the right home. Task 2.3; proposal Impact updated.
- **Status:** RESOLVED — tasks.md 2.3; proposal.md Impact

#### m4 — the decision point wording vs the `--check`/`--dry-run` call sites (MINOR)
- **Source:** adversarial-code-reviewer
- **Claim:** design said "one decision point, at the existing seam", but `--check`/`--dry-run` return before `runRecordingHandover`; an implementer following the wording literally would spawn `git remote -v` per recording or cannot satisfy `--check` at all.
- **Evidence:** `src/recording-backfill.ts:165-176,186`; design Goals.
- **Fix:** Restated: one decision function; the seam for stop/run; once per back-fill invocation for `--check`/`--dry-run` (the policy is the work tree's property).
- **Status:** RESOLVED — design.md Goals; tasks.md 2.2

#### m5 — cache key canonicalization (MINOR)
- **Source:** adversarial-code-reviewer
- **Claim:** "Keyed by absolute work-tree top" while `gitToplevel` returns `resolve(...)` (no symlink resolution) and the repo's precedent (`canonicalProjectPath`) realpaths — a hand-written key behind a symlink would never match.
- **Evidence:** `src/recording-store.ts:94-98`; `src/project-registry.ts:76-80`.
- **Fix:** Key = `realpathSync` of the top when it exists, stated in spec and design; wrong direction is withheld (safe).
- **Status:** RESOLVED — delta spec; design.md; tasks.md 1.3

#### m6 — the cache is never documented (MINOR)
- **Source:** adversarial-code-reviewer
- **Claim:** design and OUT OF SCOPE lean on "the file is documented and hand-editable", but no task writes that documentation anywhere a user would look.
- **Fix:** Task 2.4 (README: key + cache path/shape/advisory-on-corrupt); the stand-down report line names where the fix lives.
- **Status:** RESOLVED — tasks.md 2.4; delta spec report sentence

### Rules verdicts
The rules-conformance-auditor reported **no FAIL**: PASS on config-seam (the engine-constant host list is domain-neutral taxonomy with the safety rationale stated, not project vocabulary), test scope and SET_COPILOT_HOME, runtime-dir/exactly-once invariant, OpenSpec workflow (7/7 base scenarios carried verbatim, name verbatim, MODIFIED not ADDED), IN/OUT OF SCOPE, `[REQ:]` traceability (7/7 tasks), per-group tests + CLI verification, review gate correctly pending at propose stage, conventions, observable-behaviour gate, whole-surface, reuse-before-build (every cited precedent verified to exist), regression-from-field, verify-before-claiming, spec-verify-gate expectations, additive config change, file-reference hygiene. N-A on wall/redaction/audience, archive-time process, bug-root-cause (no field report), and the process rules binding the session. One hand-fixed prose nit ("a API call").

### Checked and found OK
- (adversarial-code-reviewer) Delta mechanics valid (base prose verbatim, 7/7 scenarios, validate --strict passed); no clash with the four sibling active changes (dictation-stitched-output modifies a different requirement of the same capability); the exactly-once renameSync is untouched (suppression sits after archive, before copy); no network call is implementable as written (targetBase already reads upstreams locally); no-ledger-record is correct and load-bearing (a `handover` record would make `classifyRecordings` treat the recording as saved forever); reporting streams already exist at the seam (`report()`); config merges key by key, no migration needed, not machine-local; cache placement outside any repo; design's code references accurate; planned tests pure over injected I/O; `src/index.ts` exports nothing from these modules; recent history checked (the change deliberately modifies `a54ff3d`'s default, with the reason documented).
- (rules-conformance-auditor) All verdicts PASS/N-A as above; delta-vs-base fidelity compared line by line; traceability complete; no sibling-merge risk.

### Open decisions (the user's)
- Resolved for autonomous continuation, both already argued in design.md (revisit if you disagree):
  1. **`PUBLIC_HOSTS` as an engine constant, not config** — the list is domain-neutral internet taxonomy, not project knowledge; a safety default must not be silently per-project (`wall.redaction` precedent). Extending it is an engine release.
  2. **Runtime-dir hygiene for a permanently suppressed repo** — folded into the set-repair sentence (kept recordings are expected state, not a fault); no deeper mechanism this change.
