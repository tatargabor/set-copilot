## MODIFIED Requirements

### Requirement: Graph production is a fork-producer responsibility

Graph visuals SHALL be produced by a fork of the main session (see `fork-producer`), not by a
standalone graph-worker process. This capability retains no independent worker requirements of
its own: its former requirements were removed by the `fork-wall-producer` change, whose archived
artifacts record each removal's reason, with migration to `fork-producer` (grounding, emission,
model tier) or to the server-side accumulation now specified in `wall-server` (incremental state
and replay). This requirement remains as the explicit record that graph production did not vanish —
it moved to the fork producer.

#### Scenario: A graph visual is produced by a fork, not a standalone worker

- **WHEN** the wall needs a graph visual
- **THEN** a fork of the main session composes and emits it through the `wall-emit` seam, and no
  standalone graph-worker process is involved
