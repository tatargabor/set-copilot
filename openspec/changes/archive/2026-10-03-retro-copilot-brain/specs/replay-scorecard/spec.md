## MODIFIED Requirements

### Requirement: Two runs of one scenario are comparable

The scorecard SHALL be reproducible enough to compare: given two runs of the same
scenario, a comparison SHALL show which dimensions improved, which regressed, and which
are unchanged, and SHALL identify the scenario and its version so that a scenario edit
cannot be mistaken for a copilot change.

A comparison SHALL take the noise band from the scenario it is given (`replay-score compare
<before> <after> --scenario <dir>`). A difference whose absolute size is within the band declared
for that dimension SHALL be reported as unchanged, with a note that it is inside the scenario's
measured noise band and is not evidence of a change. When the scenario declares no band for a
dimension, an improved or regressed verdict SHALL carry a note that no noise band is declared and a
single-run difference is a reading, not evidence. A dimension unmeasured in either scorecard SHALL
be reported as unmeasurable with the reason. Activity counts (the number of draws and of staged
predictions) SHALL be reported but not graded. A refused comparison SHALL exit non-zero.

A score is not evidence until the measure's own noise is known: measured on three real-time runs of
one scenario with nothing changed, coverage spanned 0.222, and on the first two runs of the harness
a comparison reported a regression where nothing had changed.

#### Scenario: A regression is visible

- **WHEN** two scorecards for the same scenario version are compared
- **THEN** each dimension is reported as improved, regressed, or unchanged

#### Scenario: A scenario change invalidates the comparison

- **WHEN** two scorecards refer to different versions of the scenario
- **THEN** the comparison refuses to present a verdict and reports that the measuring
  stick itself changed

#### Scenario: A difference inside the band is not a verdict

- **WHEN** the scenario declares `"noiseBand": {"coverage": 0.223}` and coverage moves from 0.944 to
  0.722 between two scorecards
- **THEN** coverage is reported as unchanged, with a note that the difference is inside the measured
  noise band (±0.223) and is not evidence of a change

#### Scenario: A difference outside the band is graded

- **WHEN** the scenario declares `"noiseBand": {"coverage": 0.1}` and coverage moves from 0.8 to 0.5
- **THEN** coverage is reported as regressed

#### Scenario: Without a band a difference is only a reading

- **WHEN** two scorecards are compared without a scenario, or the scenario declares no band for
  precision, and precision moves from 0.45 to 0.36
- **THEN** precision is reported as regressed, with a note that no noise band is declared and a
  single-run difference is a reading, not evidence

#### Scenario: Activity counts are not graded

- **WHEN** the number of draws differs between two scorecards
- **THEN** `draws` is reported as unchanged with the note that it is an activity count, reported and
  not graded

## ADDED Requirements

### Requirement: The judged matching is recorded in the scorecard, per moment

The scorecard SHALL persist, for every planted moment, the judged match it was scored from: the
moment id and kind, the credited event index (or none), the other events the judge said also
address the moment, the delay from the moment becoming true to the credited event (or none when not
measurable), and the judge's reasoning. The record SHALL be built from the same matching every
dimension used, so the card cannot disagree with itself. A moment the judge did not answer for SHALL
be recorded as no match with the reason that the judge did not answer, and an event index the judge
was not offered for that moment SHALL be discarded rather than trusted.

A judged verdict is not reproducible, and re-running a non-deterministic step to check it turns a
disagreement into a coin flip. Without a per-moment record, "the first event inside the window" got
used as a stand-in for the judged match in a published summary; the two disagreed by a factor of
two to five (14.0 / 4.9 / 11.0 s against the true 45.6 / 38.5 / 57.3 s), while the scorecard's own
mean had been right all along.

#### Scenario: A disputed latency can be traced to its event

- **WHEN** a scorecard reports a reaction latency for a covered moment
- **THEN** its `judgement` entry for that moment names the credited event index, the delay in
  milliseconds, and the judge's reasoning

#### Scenario: A skipped moment is unjudged, not missed silently

- **WHEN** the judge's reply omits a planted moment
- **THEN** that moment's `judgement` entry has no event index and the reasoning
  `the judge did not answer for this moment`

#### Scenario: An index outside the window is not credited

- **WHEN** the judge names an event index that was not among the moment's candidates
- **THEN** the index is discarded and the moment is recorded as unmatched

### Requirement: Precision credits every event that addresses a planted moment

The judge SHALL credit the earliest addressing event for a moment, because reaction latency means
when the copilot first addressed it, and SHALL list every other addressing candidate separately.
For precision, an event SHALL count as addressed when it is either the credited event or one of the
others named for any moment. A staged prediction that was never promoted SHALL NOT be counted as a
reaction. Event indexes SHALL refer to the full wall event log, not to a filtered subset. A
scorecard judged before the other-addressing list existed SHALL fall back to crediting the credited
event alone — the harsher reading, never a silent upgrade.

Two counting errors produced a precision of 0.10 that a run did not deserve: the judge's index
pointed into the full event log while the filter numbered only content events, so after the first
promotion the numberings diverged; and with one credit per moment, every later event on an answered
moment counted as reacting to nothing. A staged guess nobody promoted never reached the public wall,
and letting a wrong one expire is what the contract asks for.

#### Scenario: A follow-up on an answered moment is not noise

- **WHEN** events 3 and 7 both address a moment, the judge credits 3 and lists 7 as also addressing
- **THEN** neither event counts against precision, and the moment's latency is measured to event 3

#### Scenario: An unpromoted prediction is not a reaction

- **WHEN** a run staged a visual that expired without a promotion
- **THEN** it is excluded from the reactions precision counts, and it still counts against the
  prediction dimension
