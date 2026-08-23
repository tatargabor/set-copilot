## ADDED Requirements

### Requirement: The producer is taught how to promote

The drawing contract SHALL teach the promotion command: its shape, the requirement that a
staged visual carry an identifier the command can name, and when a promotion is warranted.

A contract that describes staging, states that only a promotion lifts a visual to the
public wall, and then never says how to promote is a convention the producer cannot
follow. Measured across four real-time runs: every prediction expired unpromoted.

#### Scenario: The rendered contract carries the command

- **WHEN** the copilot policy is rendered
- **THEN** it shows the promotion command's shape alongside the payload shapes

#### Scenario: The contract requires a staged visual to be identifiable

- **WHEN** the contract describes staging a prediction
- **THEN** it states that the visual must carry an id, because the promotion names it

#### Scenario: The contract states when to promote

- **WHEN** the contract describes promotion
- **THEN** it ties it to the conversation arriving at what the prediction anticipated, and
  states that an unpromoted prediction expiring is the correct outcome for a wrong guess

### Requirement: What is currently promotable can be asked for

The wall SHALL answer, on request, which staged predictions are promotable at that moment —
each with its category, its visual id, and how long it has left before expiry. An operator
SHALL be able to read the same answer from the command line.

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
