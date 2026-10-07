# Spec Delta

## IN SCOPE

- The append path stamps `promote` control lines with `emittedAt`.
- The staging gate stops being an exception to the unknown-time rule: it never substitutes a
  time for a missing stamp, so an untimed prediction is not promotable and an untimed promote
  publishes nothing (the behaviour side lives in `predictive-staging`).

## OUT OF SCOPE

- Stamping `pending` or `layout` lines; nothing decides by their time.
- Any change to how `emittedAt` is used for latency scoring.

## MODIFIED Requirements

### Requirement: Every appended event records when it was emitted

A **display event** appended to the canonical wall event log SHALL carry `emittedAt`, the
wall-clock time in milliseconds at which it entered the log. The value SHALL be written by the
append path itself, after the event is normalized, so that it is uniform across producers and
cannot be supplied or suppressed by one. A `promote` control line SHALL be stamped the same way,
because the staging gate decides a promote by when it was issued, and a wall rebuilt from the
log must be able to read that time back. The other control lines appended to the same log —
`pending` and `layout` — are not display events, nothing decides by their time, and they carry
no `emittedAt`.

`emittedAt` is the time the event reached the wall — never the time anything was said. The
transcript's own timestamps mean speech time, and a consumer that treated the two as the
same unit would compute a number that looks like a latency and is not one.

#### Scenario: An emitted event carries its emission time

- **WHEN** a producer emits a valid display event
- **THEN** the line appended to the log carries an `emittedAt` millisecond timestamp

#### Scenario: A producer cannot set its own emission time

- **WHEN** a producer supplies an `emittedAt` of its own, on a display event or a `promote`
- **THEN** the appended line carries the time the append path observed, not the supplied one

#### Scenario: Every event of one batch is stamped

- **WHEN** several display events are emitted in a single call
- **THEN** each appended line carries an `emittedAt`, in non-decreasing order

#### Scenario: A rejected event is not stamped into the log

- **WHEN** an event fails normalization
- **THEN** it is dropped as before, and nothing is appended for it

#### Scenario: A control line is not stamped

- **WHEN** a `pending` or `layout` command is appended to the log
- **THEN** its line carries no `emittedAt`

#### Scenario: A promote is stamped

- **WHEN** a valid `promote` command is appended to the log
- **THEN** its line carries an `emittedAt` millisecond timestamp written by the append path

### Requirement: An event with no emission time is read as unknown

A consumer of the event log SHALL treat a missing `emittedAt` as unknown time, and SHALL
NOT substitute zero, the current time, or a neighbouring event's time.

Logs written before this field existed remain valid and are never backfilled: a stamp
invented after the fact would be indistinguishable from a real one and would corrupt
exactly the measurements the field exists to enable.

The staging gate is the one consumer this change makes exact: it never substitutes the
current time for a missing stamp, live or replayed — a staged delta without a stamp is not
promotable, and a promote without one publishes nothing (`predictive-staging`).

#### Scenario: An older log still replays

- **WHEN** a log whose events carry no `emittedAt` is replayed to rebuild state
- **THEN** the display state is reconstructed exactly as before, with the times reported as unknown, and the staging gate revives nothing it cannot date — an unstamped prediction is not promotable after the rebuild

#### Scenario: A timing measurement over an unstamped event is refused, not guessed

- **WHEN** a consumer computes a timing figure over an event with no `emittedAt`
- **THEN** the figure is reported as unmeasurable rather than derived from a substituted value
