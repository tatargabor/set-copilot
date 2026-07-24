## ADDED Requirements

### Requirement: State-replay includes recent scroll-history

On a client connect, in addition to the current graph state and the pinned `latest` items that the
server already replays (see `wall-server` "State replay on connect"), the server SHALL replay the
last N lines of each `scroll`-behavior category (N is config; default 20), so a late-joining or
reloading window sees recent text (e.g. súgás) rather than an empty lane. The replayed scroll lines
SHALL be zone-filtered exactly like the live stream.

The scroll-history ring SHALL be part of the accumulated state the server rebuilds from the
canonical `wall-events.jsonl` on startup — so a restart that preserves the log keeps the scroll
lanes populated, not just the graphs and pinned latest. It SHALL reuse the existing once-only
guarantee (the shared line-offset between the startup rebuild and the live tail, per `wall-server`),
so a line is never applied to the ring twice.

#### Scenario: A reloading window sees recent súgás

- **WHEN** several `súgás` lines have been emitted and a window then connects (or the tab is reloaded)
- **THEN** the server replays the last N `súgás` lines to that window, zone-filtered, so the hint lane
  is not blank on connect

#### Scenario: Scroll-history replay respects zones

- **WHEN** a `private`-zone súgás line is in the recent history and a `public` window connects
- **THEN** that private line is NOT replayed to the public window

#### Scenario: Restart with a preserved log restores the scroll lanes

- **WHEN** the server is stopped and restarted while `wall-events.jsonl` is preserved
- **THEN** the rebuilt state includes the scroll-history ring, so on the next connect the scroll lanes
  reflect the recent lines from the log rather than being blank — and no line is double-counted across
  the rebuild and the live tail

### Requirement: A fresh wall run rotates the log aside, never truncates a live one

The wall event log SHALL follow the same archive-not-truncate invariant as the transcript: a fresh
run SHALL rotate `wall-events.jsonl` aside (rename with a timestamp) rather than truncating it, and
during live use the log SHALL NOT be truncated mid-session. A `wall --reset` path SHALL perform this
safe rotation so an operator never has to hand-delete a live log.

#### Scenario: Reset rotates the log, does not truncate

- **WHEN** an operator runs `wall --reset` on a runtime dir that has a `wall-events.jsonl`
- **THEN** the existing log is renamed aside with a timestamp (preserved, not truncated) and a fresh
  empty log begins, mirroring the transcript hand-over invariant

#### Scenario: A live log is not truncated mid-session

- **WHEN** a wall server is running and serving clients
- **THEN** nothing truncates its `wall-events.jsonl` in place — a reset uses a new runtime dir or the
  deliberate rotation above, so the accumulated state and its rebuild source are never silently lost
