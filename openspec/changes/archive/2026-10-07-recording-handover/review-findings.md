# Review findings — recording-handover

## Round 1 — 2026-10-07

Reviewers: adversarial-code-reviewer (blind), rules-conformance-auditor (blind). One run of each
covered the three changes proposed together; this file holds the part about this change.

Note: implementation started in the worktree while the reviewers were still running (the
adversarial reviewer saw uncommitted edits and cited `HEAD`). Every finding was re-checked against
the code as committed, and the artifacts were revised before the apply commit.

### Status
| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| A1 | MAJOR | a second SHA-256 ledger beside `recovery-ledger` | RESOLVED — design D5: a `handover` step in the recovery ledger; marker beside it |
| A2 / R4 | MAJOR | tests / runs could write into the developer's machine (`SET_COPILOT_HOME`, `projectRoot`) | RESOLVED — tests set `projectRoot` + `SET_COPILOT_HOME` to temp dirs; ledger now project-local; dry runs hashed before/after (tasks 1.1, 3.1, 3.2, 4.1) |
| R1 | MAJOR | kind taken from `--print`, but the SessionEnd `stop` archives open dictations on the meeting path | RESOLVED — `kindOf(archived)` on both paths; spec scenario; design D8 |
| R2 | MAJOR | "stdout is exactly the dictated text" is false (`Stopped capture …` is printed to stdout by `stop`) | RESOLVED — scenarios narrowed to "nothing this change adds reaches stdout"; the pre-existing mismatch with `dd/SKILL.md` reported, not changed (OUT OF SCOPE) |
| R3 | MAJOR | `backfill --check/--dry-run` run the writing preflight; `--check` could exit 1 | RESOLVED — preflight runs as a dry run for them; `--check` silent + exit 0 on an unloadable config (design D7, spec) |
| R5 | MAJOR | a project that does not ignore `.set/` matches its own archive | RESOLVED — `.set/` excluded from identity; scenario + test |
| R6 | MAJOR | built-in target hard-coded, cannot be switched off; privacy | RESOLVED (mechanism) — a no-op command (`true`) opts out, documented; whether the default is on everywhere is an open decision below |
| R7 | MAJOR | `part<N>` collides across machines → add/add conflicts | RESOLVED — names carry `-<sha8>` (deviation from the plan's naming, design D8) |
| R8 | MINOR | a speechless dictation is copied | RESOLVED — no speech, no copy |
| R9 | MINOR | hook de-dup by exact string vs "matched by script name" | RESOLVED — `registerHook(…, scriptBasename)` |
| R10 | MINOR | archive order vs `dictation-stitched-output` | REJECTED — that change has an open live-mic check (task 6.3) and is not this session's to archive; this change carries its text, so its later archive fails loudly rather than silently reverting |
| R11 | MINOR | call sites missing from tasks (config.ts comments, CLAUDE.md, help) | RESOLVED — task 5.1 |
| R12 | MINOR | non-atomic copy | RESOLVED — temp + rename |
| R13 | MINOR | stale derived files beside a live-named file | RESOLVED — reused only when not older than the raw file |
| R14 | MINOR | name filter duplicated; replay dirs not excluded | RESOLVED — `isCaptureOutput` reused; `replay-run.json` dirs skipped |
| R15 | MINOR | `/dd` latency | RESOLVED — measured and stated (design D8, tasks 1.3/2.2) |
| A3 | MINOR | new stderr lines lack the `[set-copilot]` prefix requirement | RESOLVED — spec requires the prefix |
| A4 | MINOR | base text made inaccurate ("Stop-time stitching…", CLAUDE.md "--print produces nothing derived") | RESOLVED — MODIFIED "Stop-time stitching is configurable"; task 5.1 names CLAUDE.md. The scenario title "No command configured leaves the handover unchanged" cannot be renamed (archive carries base scenario names); its text was reframed |
| A5 | MINOR | sibling change not noted | RESOLVED — proposal Impact |
| A6 | MINOR | example path mirrored a consumer's filing convention | RESOLVED — `notes/kept-copy.jsonl` |

### Rules verdicts
Auditor: all PASS / N-A except reuse-before-build (A1), the `SET_COPILOT_HOME` rule (A2) and the
cross-cutting checklist (A5) — all resolved above.

### Checked and found OK
- (adversarial) no new domain regex; dictation uses the same `stitchFile`; back-fill copies, never renames; failures never fail the stop; `index.ts` does not export the hand-off functions; e8cdd5c's "no derived artifacts" reversed deliberately for the copy only.
- (auditor) ADDED/MODIFIED classification and scenario carry-forward; scope sections; REQ traceability 8/8; runtime-dir invariant preserved; no skill fork; no new config key.

### Open decisions (the user's)
- Should the built-in target be on by default in every project (including public repos — a `/dd` there leaves untracked dictation files that a careless `git add -A` would publish)? Today: on; opt-out per project with `"dictationHandoverCommand": "true"` / `"handoverCommand": "true"`.
