## ADDED Requirements

### Requirement: Every appended event records when it was emitted

An event appended to the canonical wall event log SHALL carry `emittedAt`, the wall-clock
time in milliseconds at which it entered the log. The value SHALL be written by the append
path itself, after the event is normalized, so that it is uniform across producers and
cannot be supplied or suppressed by one.

`emittedAt` is the time the event reached the wall — never the time anything was said. The
transcript's own timestamps mean speech time, and a consumer that treated the two as the
same unit would compute a number that looks like a latency and is not one.

#### Scenario: An emitted event carries its emission time

- **WHEN** a producer emits a valid event
- **THEN** the line appended to the log carries an `emittedAt` millisecond timestamp

#### Scenario: A producer cannot set its own emission time

- **WHEN** a producer supplies an `emittedAt` of its own
- **THEN** the appended event carries the time the append path observed, not the supplied one

#### Scenario: Every event of one batch is stamped

- **WHEN** several events are emitted in a single call
- **THEN** each appended line carries an `emittedAt`, in non-decreasing order

#### Scenario: A rejected event is not stamped into the log

- **WHEN** an event fails normalization
- **THEN** it is dropped as before, and nothing is appended for it

### Requirement: An event with no emission time is read as unknown

A consumer of the event log SHALL treat a missing `emittedAt` as unknown time, and SHALL
NOT substitute zero, the current time, or a neighbouring event's time.

Logs written before this field existed remain valid and are never backfilled: a stamp
invented after the fact would be indistinguishable from a real one and would corrupt
exactly the measurements the field exists to enable.

#### Scenario: An older log still replays

- **WHEN** a log whose events carry no `emittedAt` is replayed to rebuild state
- **THEN** the state is reconstructed exactly as before, with the times reported as unknown

#### Scenario: A timing measurement over an unstamped event is refused, not guessed

- **WHEN** a consumer computes a timing figure over an event with no `emittedAt`
- **THEN** the figure is reported as unmeasurable rather than derived from a substituted value
