## MODIFIED Requirements

### Requirement: A fresh wall run rotates the log aside, never truncates a live one

The wall event log SHALL follow the same archive-not-truncate invariant as the transcript: it SHALL
never be truncated, and during live use it SHALL NOT be disturbed mid-session. A plain `set-copilot
wall` start SHALL keep the existing log and rebuild the accumulated state from it; only the deliberate
`wall --reset` path SHALL rotate `wall-events.jsonl` aside (rename with a timestamp), and only after
confirming that no wall is live for the runtime dir — so an operator never has to hand-delete a log,
and a running wall's log is never rotated out from under it. A missing or empty log is left as it is;
the new run's log is created by its first append.

#### Scenario: Reset rotates the log, does not truncate

- **WHEN** an operator runs `wall --reset` on a runtime dir that has a non-empty `wall-events.jsonl`
  and no live wall
- **THEN** the existing log is renamed aside with a timestamp (preserved, not truncated) and the new
  run starts from an empty state, its log created by the first append — mirroring the transcript
  hand-over invariant

#### Scenario: A live log is not truncated mid-session

- **WHEN** a wall server is running and serving clients
- **THEN** nothing truncates its `wall-events.jsonl` in place — a reset uses a new runtime dir or the
  deliberate rotation above, so the accumulated state and its rebuild source are never silently lost

#### Scenario: A plain restart rebuilds from the existing log

- **WHEN** the wall is started without `--reset` on a runtime dir whose `wall-events.jsonl` holds an
  earlier run's events
- **THEN** the log is not rotated, and the accumulated state is rebuilt from it
