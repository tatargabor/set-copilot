# Review findings — fast-lane-opener-boundary

## Round 1 — 2026-10-07

Reviewers: adversarial-code-reviewer (blind), rules-conformance-auditor (blind). One run of each
covered the three changes proposed together; this file holds the part about this change.

Note: implementation started in the worktree while the reviewers were still running; the
adversarial reviewer cited `HEAD`. Findings re-checked against the committed code.

### Status
| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| F1 | MINOR | chunk/whisper backends emit pieces with no leading space — an opener at a chunk end would never confirm | RESOLVED — design D4, spec IN SCOPE + scenario, task 2.2 (`chunkEventText`) |
| F2 | MINOR | apostrophe/hyphen still confirm an opener | RESOLVED — stated limit, design D5 + OUT OF SCOPE |
| F3 | MINOR | the scenario was softened from "text `rajzold`" to "carrying `rajzold`" during apply | RESOLVED — decision recorded in design D5 (today's extraction keeps leading punctuation) |

### Rules verdicts
Auditor: no findings; every applicable rule PASS.

### Checked and found OK
- (adversarial) closer asymmetry keeps latency; per-speaker buffers; Unicode classes with `u`; no config/CLI/event change; base scenarios carried; `Copi`+`lot` still opens.
- (auditor) MODIFIED carries both base scenarios verbatim; field reproduction fails before the fix; adjacent `stop`/`stoppolni` risk reported, not fixed.

### Open decisions (the user's)
- none
