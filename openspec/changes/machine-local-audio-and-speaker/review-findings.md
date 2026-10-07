# Review findings — machine-local-audio-and-speaker

## Round 1 — 2026-10-07

Reviewers: adversarial-code-reviewer (blind), rules-conformance-auditor (blind). One run of each
covered the three changes proposed together (recording-handover, machine-local-audio-and-speaker,
fast-lane-opener-boundary); this file holds the part about this change.

Note: implementation started in the worktree while the reviewers were still running (the
adversarial reviewer saw uncommitted edits and cited `HEAD` instead). Every finding below was
re-checked against the code as finally committed.

### Status
| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| A-M1 | MAJOR | `doctor --fix` contradicts "Diagnostics SHALL report, never repair" | RESOLVED — setup-diagnostics delta MODIFIES the governing requirement with the explicit `--fix` exception |
| B-M1 | MAJOR | `init` itself tells the user to put the mic into the project config; README/dictate skill too | RESOLVED — tasks 3.1/4.1; init text changed |
| A-m2 | MINOR | group 3 has no vitest task | RESOLVED — `withoutMachineLocalKeys` + test (task 3.1) |
| A-m3 | MINOR | sibling change not noted | RESOLVED — proposal Impact |
| B-M2 | MINOR | wording that says "project outranks machine" becomes false | RESOLVED — device finding fix text; "Device names migrate…" MODIFIED |
| B-M3 | MINOR | `init`'s drift report would not show the new finding | RESOLVED — `reportConfigDrift` passes `projectConfigTracked` |
| B-M4 | MINOR | precedence flip silent where both layers disagree | RESOLVED — finding names the ignored project value; scenario added |

### Rules verdicts
All PASS / N-A except the three FAILs above (A-M1 openspec-conventions/carry-forward,
A-m2 config.yaml tests-per-group, A-m3 cross-cutting checklist), all resolved.

### Checked and found OK
- (adversarial) operand swap keeps empty-is-unset; `MIC_SOURCE` `??` escape still wins; existing tests test the function, not the order; `--fix` mirrors migration v1; no clash beyond `config.ts`.
- (auditor) base scenarios carried forward; scope sections; REQ traceability; `SET_COPILOT_HOME` in every config test; no names or absolute paths.

### Open decisions (the user's)
- Bind `transcript.speakers.mic` at capture time instead of stitch time? (design D5)
