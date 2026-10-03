---
paths: ["src/**"]
---

# A defect seen in real use gets a reproduction that fails before the fix

When a fix answers a defect observed in real use (a meeting, a dictation, a live wall),
the fix ships with something that **fails before it and passes after it**:

- **Pure logic** (config resolution, flush rules, stitch, redaction, keyword matching,
  mirror formatting, migrations) → a vitest case, built from the real failing input
  where possible (a trimmed transcript excerpt, the offending config). Run it against
  the unfixed code first and quote the failure.
- **Audio / Soniox / PID / copilot-path defects**, which the tests cannot reach → a replay
  scenario (`set-copilot replay`, see `docs/replay-harness.md`; a neutral one may live in
  `scenarios/`, anything built from partner material belongs in the private scenario
  repo), or a **documented CLI reproduction** — the exact commands and the observed
  output — in the change's design or the commit message.

A fix without either is reported as unverified (`verify-before-claiming.md`). Any test
that spawns the real CLI sets `SET_COPILOT_HOME`.
