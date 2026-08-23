# replay-scorecard Specification

## Purpose
Turns one replay run into a comparable number: what the copilot did against what the
scenario said it should do, so a change to the copilot can be shown to have made it
better or worse rather than merely different.

## Requirements

### Requirement: A score is computed from the run's own artifacts

Scoring SHALL read the artifacts the run itself produced — the wall event log, the
transcript that was played, and the copilot session's own output — and compare them
against the scenario's planted expectations. Scoring SHALL NOT require the copilot to
have been instrumented or to have known it was being measured.

#### Scenario: A run is scored after the fact

- **WHEN** a completed run's artifacts and its scenario are given to the scorer
- **THEN** a scorecard is produced without re-running the copilot

#### Scenario: Missing evidence is reported, not guessed

- **WHEN** an artifact a dimension depends on is absent or unreadable
- **THEN** that dimension is reported as unmeasured with the reason, and the remaining
  dimensions are still scored

### Requirement: The scorecard measures reaction, drawing, judgement, and noise

A scorecard SHALL report: how long after a line was played the copilot's reaction
appeared; how long a drawn visual took to appear; how many predicted visuals were
promoted versus expired unused; how many planted moments drew a correct reaction and how
many reactions had no planted moment behind them; how much of the copilot's output was
filler; and how many planted moments passed with no reaction at all.

#### Scenario: A correct reaction to a planted moment is credited

- **WHEN** the copilot reacts to a planted moment in the way the expectation describes
- **THEN** that moment counts as covered, and the delay between the line and the
  reaction is recorded

#### Scenario: A missed planted moment is counted

- **WHEN** a planted moment passes with no corresponding reaction
- **THEN** it is reported as a miss, naming the moment and what was expected

#### Scenario: A reaction with no planted moment behind it is counted separately

- **WHEN** the copilot produces a reaction that matches no planted moment
- **THEN** it is counted against precision rather than silently ignored, because a
  copilot that reacts to everything is not a good copilot

#### Scenario: Filler is measured, not judged away

- **WHEN** the copilot's output contains acknowledgement or progress lines carrying no
  substance
- **THEN** their share of the output is reported as a dimension of its own

#### Scenario: A prediction that was never promoted is counted

- **WHEN** the run staged a predicted visual that expired without being promoted
- **THEN** it is counted against the prediction dimension, distinguishing a copilot that
  anticipates well from one that guesses often

### Requirement: Mechanical and judged dimensions are separated

Dimensions computable from timestamps and event records SHALL be computed. Dimensions
requiring an assessment of whether a reaction was *right* SHALL be judged, and the
scorecard SHALL state which dimensions were judged rather than computed.

#### Scenario: The scorecard marks its judged dimensions

- **WHEN** a scorecard is produced
- **THEN** each dimension states whether it was computed or judged

#### Scenario: A judged dimension carries its reasoning

- **WHEN** a dimension was judged
- **THEN** the scorecard records the reasoning behind the verdict, so a disputed score
  can be inspected rather than merely re-run

### Requirement: A run may only report figures its playback speed supports

The scorecard SHALL record the playback speed of the run it describes. When a run was
not played in real time, every dimension derived from elapsed time SHALL be reported as
invalid rather than as a number.

#### Scenario: A sped-up run reports no latency

- **WHEN** a scorecard describes a run played faster than real time
- **THEN** its latency dimensions read as invalid-for-this-speed, and the content
  dimensions are reported normally

#### Scenario: A real-time run reports every dimension

- **WHEN** a scorecard describes a run played in real time
- **THEN** all dimensions are reported

#### Scenario: A comparison refuses mismatched speeds for latency

- **WHEN** two runs of the same scenario at different speeds are compared
- **THEN** the comparison reports the content dimensions and refuses to compare the
  latency dimensions, naming the speed mismatch

### Requirement: Two runs of one scenario are comparable

The scorecard SHALL be reproducible enough to compare: given two runs of the same
scenario, a comparison SHALL show which dimensions improved, which regressed, and which
are unchanged, and SHALL identify the scenario and its version so that a scenario edit
cannot be mistaken for a copilot change.

#### Scenario: A regression is visible

- **WHEN** two scorecards for the same scenario version are compared
- **THEN** each dimension is reported as improved, regressed, or unchanged

#### Scenario: A scenario change invalidates the comparison

- **WHEN** two scorecards refer to different versions of the scenario
- **THEN** the comparison refuses to present a verdict and reports that the measuring
  stick itself changed
