# replay-scenario Specification

## Purpose
Defines what a replay scenario is: the transcript lines to be played, the ground truth
about what the copilot should have noticed in them, and a human-readable timeline that
makes the whole thing inspectable before anyone runs it.

## Requirements

### Requirement: A scenario is a transcript, a ground truth, and a timeline

A scenario SHALL consist of three files that travel together: the transcript lines to
play, an expectations record naming what the copilot should do and when, and a
human-readable timeline. All three SHALL be stored under version control so that a
scenario is a stable measuring stick across runs.

#### Scenario: All three parts are present

- **WHEN** a scenario is loaded
- **THEN** its lines, its expectations, and its timeline are resolved together, and a
  scenario missing any of them is rejected with the missing part named

#### Scenario: The lines are valid transcript lines

- **WHEN** a scenario's lines are loaded
- **THEN** each is a well-formed transcript line carrying a speaker channel, an end
  timestamp, a start timestamp, and its detection flags, and a malformed line is
  reported with its position rather than silently skipped

### Requirement: A scenario plants ground truth deliberately

A scenario SHALL carry planted moments that make copilot behaviour measurable: at least
one contradiction against the source material, at least one open question, at least one
decision worth recording, audience speech on the system channel, and at least one direct
address to the copilot. Each planted moment SHALL record where in the scenario it occurs
and what the copilot is expected to do about it.

#### Scenario: A planted moment names its expected reaction

- **WHEN** an expectations record is loaded
- **THEN** each planted moment carries the scenario position it refers to, the kind of
  reaction expected, and a description of what a correct reaction contains

#### Scenario: The audience is a separate channel

- **WHEN** a scenario represents someone other than the presenter speaking
- **THEN** those lines carry the system channel, so a run exercises the two-channel path
  rather than a single-speaker one

#### Scenario: A scenario without planted moments is rejected

- **WHEN** a scenario is loaded whose expectations record contains no planted moments
- **THEN** it is rejected, because a run against it could not distinguish a working
  copilot from a silent one

### Requirement: The timeline is readable and matches the lines

A scenario SHALL be inspectable without reading JSONL: a generated timeline document
SHALL state, for each point in the scenario, when it happens, which section of the
source material it belongs to, who is speaking, and what is said, with the planted
moments marked. The timeline SHALL be derived from the lines, so it cannot drift from
what will actually be played.

#### Scenario: An operator can read what will be played

- **WHEN** an operator opens a scenario's timeline
- **THEN** they can follow the whole run in order — time, section, speaker, and text —
  without opening the transcript fixture

#### Scenario: Planted moments are visible in the timeline

- **WHEN** the timeline covers a position carrying a planted moment
- **THEN** that moment is marked at its position, with the reaction it expects

#### Scenario: The timeline is regenerated from the lines

- **WHEN** a scenario's lines change
- **THEN** regenerating the timeline reflects the change, and a timeline that disagrees
  with the lines is reported as stale

### Requirement: A scenario is authored from any source material

Scenario authoring SHALL NOT be tied to one deck, format, or project. The harness SHALL
accept a scenario authored from any source material, and no part of the replay or
scoring path may depend on a particular source.

#### Scenario: A second scenario needs no code change

- **WHEN** a scenario is authored from source material unrelated to the first one
- **THEN** it plays and scores through the same commands, with no modification to the
  harness

#### Scenario: The source material is recorded, not required

- **WHEN** a scenario is loaded
- **THEN** it names the source material it was authored from for provenance, and the
  absence of that material on disk does not prevent the scenario from playing
