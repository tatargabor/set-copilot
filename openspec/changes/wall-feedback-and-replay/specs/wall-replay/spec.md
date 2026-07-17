## ADDED Requirements

### Requirement: State-replay includes recent scroll-history

On a client connect, in addition to the current graph state and the pinned `latest` items, the server
SHALL replay the last N lines of each `scroll`-behavior category (N is config; default 20), so a
late-joining or reloading window sees recent text (súgás, transcript) rather than an empty lane. The
replayed scroll lines SHALL be zone-filtered exactly like the live stream.

#### Scenario: A reloading window sees recent súgás

- **WHEN** several `súgás` lines have been emitted and a window then connects (or the tab is reloaded)
- **THEN** the server replays the last N `súgás` lines to that window, zone-filtered, so the hint lane
  is not blank on connect

#### Scenario: Scroll-history replay respects zones

- **WHEN** a `private`-zone súgás line is in the recent history and a `public` window connects
- **THEN** that private line is NOT replayed to the public window

### Requirement: The server rebuilds accumulated state from the canonical JSONL log on startup

On startup, the server SHALL rebuild its accumulated display state (graphs per visual, pinned latest,
scroll-history) by reading the canonical `wall-events.jsonl` log, so a restart that preserves the log
does not lose the wall. Each logged line SHALL be applied to the accumulated state exactly once — the
startup rebuild and the live tail MUST NOT double-process the same line.

#### Scenario: Restart with a preserved log restores the wall

- **WHEN** the server is stopped and restarted while `wall-events.jsonl` is preserved
- **THEN** on the next client connect the replay reflects the full accumulated state (graphs, latest,
  scroll-history) rebuilt from the log, not an empty wall

#### Scenario: No double-processing across rebuild and tail

- **WHEN** the server rebuilds state from the existing log at startup and then the live tail begins
- **THEN** lines already applied by the rebuild are not applied a second time by the tail (accumulated
  counts and graph nodes are not duplicated)
