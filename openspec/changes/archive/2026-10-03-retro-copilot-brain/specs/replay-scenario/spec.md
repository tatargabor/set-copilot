## ADDED Requirements

### Requirement: A scenario's fingerprint covers what changes a score, and nothing else

Loading a scenario SHALL compute a content fingerprint (the first 16 hex characters of a SHA-256)
over the scenario meta, the script and the expectations. The meta SHALL be included with its keys
sorted, so key order does not move the fingerprint, and SHALL exclude `noiseBand` and every key
starting with `_`. Every other meta key — including `reactionCategories` and `defaultWithinMs` —
SHALL be included, because each changes what a score means.

The boundary is "changes the score" versus "changes the commentary". Leaving the meta out let two
runs be declared comparable after being measured with different rulers — caught by editing
`reactionCategories` and watching precision move while the fingerprint held. Putting `noiseBand` in
made the ruler circular: measuring the noise requires runs, recording the result changed the
fingerprint, and that invalidated the very scorecards it was measured from — a loop with no fixed
point.

#### Scenario: Recording a noise band keeps the fingerprint

- **WHEN** `"noiseBand": {"coverage": 0.2}` is added to a scenario's meta
- **THEN** the scenario's fingerprint is unchanged

#### Scenario: A note is not part of the ruler

- **WHEN** `"_note": "why we measure it this way"` is added to a scenario's meta
- **THEN** the scenario's fingerprint is unchanged

#### Scenario: A scoring key moves the fingerprint

- **WHEN** a scenario's `reactionCategories` or `defaultWithinMs` is edited
- **THEN** the scenario's fingerprint changes, and scorecards taken before and after cannot be
  compared

#### Scenario: Key order is irrelevant

- **WHEN** two metas differ only in the order of `language` and `defaultWithinMs`
- **THEN** their fingerprints are equal

### Requirement: A scenario may declare its measured noise band

A scenario's meta MAY carry `noiseBand`, a map from scorecard dimension name to the run-to-run
spread measured for that dimension, in that dimension's own unit. The band SHALL be a property of
the scenario, not of the engine: the harness SHALL read it as declared and SHALL NOT compute,
round or adjust it. The documented measuring convention is to take it from repeated real-time runs
of unchanged code, round it **up**, and treat a band from three runs as a lower bound on the noise.

Noise is a property of this script against this copilot, not a constant. Measured: two runs of a
seven-moment scenario moved coverage 0.857 → 0.571 with nothing changed, and widening it to
eighteen moments cut that spread to 0.167, because one moment stopped being worth a seventh of the
score. A band rounded down excludes the very runs that defined it (a 0.2222 difference fell outside
a 0.222 band). The band captures the copilot's and the judge's variation together, unseparated.

#### Scenario: A declared band is read verbatim

- **WHEN** a scenario's meta declares `"noiseBand": {"coverage": 0.223, "precision": 0.284, "reactionLatency": 2244}`
- **THEN** a comparison run with that scenario applies exactly those values per dimension

#### Scenario: A scenario without a band still loads

- **WHEN** a scenario's meta declares no `noiseBand`
- **THEN** the scenario loads, plays and scores normally

### Requirement: A scenario declares which categories count as reactions

A scenario's meta MAY carry `reactionCategories`, the wall categories whose events count as
reactions for precision. When absent, every category SHALL count. The category names SHALL live in
the scenario, never in the engine.

A copilot is configured to do continuous things — running narration, a pinned summary — that
legitimately match no planted moment; counting those against precision punishes it for obeying its
own policy (measured: precision read 0.375 while every planted moment had been answered). The
taxonomy is a project's own, so hardcoding the shipped category ids in `src/` would repeat the
failure mode this package keeps having.

#### Scenario: Only declared categories are reactions

- **WHEN** a scenario declares `"reactionCategories": ["súgás"]` and a run emits narration and
  `súgás` events
- **THEN** only the `súgás` events are counted as reactions for precision

#### Scenario: No declaration counts everything

- **WHEN** a scenario declares no `reactionCategories`
- **THEN** every category's events count as reactions, and the precision detail says so
