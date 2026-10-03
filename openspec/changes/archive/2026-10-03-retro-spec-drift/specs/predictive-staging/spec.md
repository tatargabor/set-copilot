## MODIFIED Requirements

### Requirement: An unused prediction expires quietly

A staged prediction that is not promoted SHALL stop being promotable once a bounded window has
elapsed since its most recent staged delta. The window SHALL be configured as `wall.staging.ttlMs`
(default 120 000 ms; a missing or non-positive value falls back to the default), and every further
`staged:true` delta for the same visual SHALL restart it. The promote gate SHALL decide expiry by
the clock at the moment of the promote, not by whether a periodic sweep has already run — so a
prediction past its window is never promotable, even between two sweeps.

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

### Requirement: What is currently promotable can be asked for

The wall SHALL answer, on request, which staged predictions are promotable at that moment —
each with its category, its visual id, and how long it has left before expiry (an endpoint,
`/api/staged`, returning `{staged:[{category, visual, expiresInMs}]}`). An operator SHALL be able
to read the same answer from the command line (`set-copilot wall-staged`), for the runtime dir the
command is scoped to.

The producer must not have to *remember* what it staged. Prompt-held memory is what this
project replaced with a mechanism once already, after a live meeting proved it drifts.

#### Scenario: A staged prediction is listed while it is promotable

- **WHEN** a prediction has been staged and has not expired or been promoted
- **THEN** asking the wall lists it with its category, visual id, and remaining time

#### Scenario: A promoted prediction is no longer listed

- **WHEN** a staged prediction has been promoted
- **THEN** it no longer appears, because it is no longer promotable

#### Scenario: An expired prediction is no longer listed

- **WHEN** a staged prediction has passed its expiry
- **THEN** it no longer appears, and asking does not revive it

#### Scenario: Asking changes nothing

- **WHEN** the promotable list is requested
- **THEN** no event is broadcast, no expiry is deferred, and no state changes

#### Scenario: Nothing staged is an empty answer, not an error

- **WHEN** nothing is staged
- **THEN** the answer is an empty list

#### Scenario: No running wall is an error, not an empty answer

- **WHEN** the command-line query runs for a runtime dir with no running wall
- **THEN** it SHALL exit non-zero saying no wall is running, rather than print an empty list that
  would read as "nothing staged"

## ADDED Requirements

### Requirement: A staged event on a non-private zone is rejected whole

An event carrying `staged:true` with any zone other than `private` SHALL be rejected — both when
`wall-emit` validates it and when the server ingests it — and SHALL NOT be accepted with the flag
stripped. Stripping the flag would still publish the content: a single wrong zone value would put
an unspoken guess on the public wall with no backstop.

#### Scenario: A staged prediction with a shared zone is dropped

- **WHEN** a producer emits an event with `staged:true` and `zone:"both"`
- **THEN** the event SHALL be rejected with a reason naming the zone, and nothing SHALL reach any
  client

### Requirement: Only an identified graph enters the promotable registry

Promotion, listing and expiry SHALL apply to staged **graph** visuals that carry a `visual` id:
only such an event registers a prediction. A staged event that is not a graph, or carries no
`visual` id, is a private display event and nothing more — it SHALL NOT be listed as promotable,
SHALL NOT be promotable, and SHALL NOT receive an expiry marker.

#### Scenario: A staged graph with an id is registered

- **WHEN** a producer stages a private graph reset with `staged:true` and a `visual` id
- **THEN** the prediction SHALL appear in the promotable list for its category and visual

#### Scenario: A staged chart is not promotable

- **WHEN** a producer emits a private chart with `staged:true`
- **THEN** it SHALL NOT appear in the promotable list
