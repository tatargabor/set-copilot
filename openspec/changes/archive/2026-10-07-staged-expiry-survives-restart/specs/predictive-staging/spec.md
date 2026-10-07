# Spec Delta

## IN SCOPE

- The expiry window and the promote gate measured in emission time, live and on replay.
- A wall rebuilt from its log reaches the promote decisions the live wall reached.
- Lines from before stamping fail closed during the startup replay.

## OUT OF SCOPE

- The `ttlMs` default, the sweep interval, and the private expiry marker's shape.
- Persisting the promotable registry anywhere other than the event log.
- `wall --reset`, which rotates the log aside and so starts with no predictions at all.
- Rebuild decisions after an operator changed `wall.staging.ttlMs` between the runs: the
  decision rides the current config, because the log carries stamps, not the ttl.

## MODIFIED Requirements

### Requirement: An unused prediction expires quietly

A staged prediction that is not promoted SHALL stop being promotable once a bounded window has
elapsed since its most recent staged delta. The window SHALL be configured as `wall.staging.ttlMs`
(default 120 000 ms; a missing or non-positive value falls back to the default), and every further
`staged:true` delta for the same visual SHALL restart it. The promote gate SHALL decide expiry by
the clock at the moment of the promote, not by whether a periodic sweep has already run — so a
prediction past its window is never promotable, even between two sweeps.

"The clock" is **emission time**: a staged delta's window SHALL run from that delta's `emittedAt`,
and a promote SHALL be judged at its own `emittedAt`. Because both are written into the canonical
event log, a wall that rebuilds its state from that log after a restart SHALL reach — for an
unchanged `wall.staging.ttlMs` — the same promote decisions the live wall reached: a prediction
that had expired stays expired, a promote that was refused stays refused, and a promote that
succeeded is lifted again. A restart SHALL NOT grant any prediction a fresh window.

A line that carries no `emittedAt` — replayed from the log or arriving live — cannot show when it
happened. Such a staged delta SHALL NOT enter the promotable registry (it is still shown
privately), and such a promote SHALL publish nothing, so a log written before stamping can only
make a prediction less promotable, never more. A stamp that cannot be honest is read the same
way: a promote whose `emittedAt` is later than the moment it is processed, or earlier than the
staged prediction it names, SHALL publish nothing and leave the prediction in the registry.

There is no engine-side divergence detection: when the conversation moves away from a prediction,
the producer lets it expire. On expiry the server SHALL drop the prediction from the promotable
registry and broadcast an expiry marker (`stage-expired`, naming its category and visual) to
**private** clients only; a private view SHALL mark the boxes showing that category as holding an
expired prediction (dimmed and badged), so a stale guess is never mistaken for a live one. The
shipped default has no private view, so there the expiry is invisible — and that is safe, because
the prediction never had a display surface in the first place.

#### Scenario: A diverged prediction is released

- **WHEN** the conversation moves away from a staged prediction and the expiry window passes
- **THEN** the staged visual is released from the promotable registry, marked as expired in the
  private view, and is no longer eligible for promotion

#### Scenario: Expiry is decided by the clock at promote time

- **WHEN** a promote names a prediction whose window has passed but which the periodic sweep has
  not yet released
- **THEN** the promote SHALL publish nothing, and the prediction SHALL be retired as expired

#### Scenario: A further staged delta keeps the prediction fresh

- **WHEN** the producer appends another `staged:true` delta to a staged visual before its window
  passes
- **THEN** the window SHALL restart from that delta

#### Scenario: The expiry marker never reaches a public client

- **WHEN** a staged prediction expires while a public-audience window is connected
- **THEN** that window SHALL NOT receive the expiry marker

#### Scenario: A restart does not revive an expired prediction

- **WHEN** a prediction was staged longer ago than its window, and the wall restarts and rebuilds
  from the log
- **THEN** the prediction is not promotable, and a public client that connects after the restart
  receives nothing from it

#### Scenario: A promote refused live stays refused on rebuild

- **WHEN** the log holds a staged delta and, later than its window, a promote for it that the live
  wall refused, and the wall restarts
- **THEN** the rebuild publishes nothing from that prediction

#### Scenario: A promote that succeeded live is lifted again on rebuild

- **WHEN** the log holds a staged delta and, within its window, a promote that the live wall
  executed, and the wall restarts
- **THEN** the rebuilt public state shows the promoted visual, as it did before the restart

#### Scenario: An unstamped line fails closed

- **WHEN** the server meets a `staged:true` delta or a `promote` without `emittedAt`, from the startup replay or arriving live
- **THEN** the delta is shown privately but is not promotable, and the promote publishes nothing

#### Scenario: A stamp that cannot be honest is refused

- **WHEN** a promote's `emittedAt` is later than the moment it is processed, or earlier than the staged prediction it names
- **THEN** the promote publishes nothing, and the prediction stays in the registry
