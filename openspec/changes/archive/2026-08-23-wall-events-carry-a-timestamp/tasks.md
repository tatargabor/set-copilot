## 1. Stamp

- [x] 1.1 Stamp each normalized event with `emittedAt` at the single append point in `emitWallEvents`, after normalization, so a producer can neither forge nor omit it. [REQ: Every appended event records when it was emitted]
- [x] 1.2 Add `emittedAt` to the `DisplayEvent` type, documented as emission time and explicitly not speech time. [REQ: Every appended event records when it was emitted]

## 2. Tests

- [x] 2.1 Unit-test that an emitted event carries a plausible `emittedAt`, that a batch stamps every line in non-decreasing order, and that a producer-supplied value is overwritten. [REQ: Every appended event records when it was emitted]
- [x] 2.2 Unit-test that a rejected event appends nothing. [REQ: Every appended event records when it was emitted]
- [x] 2.3 Confirm the existing replay/resume suites still reconstruct state from unstamped events. [REQ: An event with no emission time is read as unknown]

## 3. Verify

- [x] 3.1 Run a live wall + emit and confirm the log carries usable per-event times. [REQ: Every appended event records when it was emitted]

## Acceptance Criteria (from spec scenarios)

- [x] AC-1: An emitted event's log line carries an `emittedAt` millisecond timestamp. [REQ: Every appended event records when it was emitted, scenario: An emitted event carries its emission time]
- [x] AC-2: A producer-supplied `emittedAt` is replaced by the observed one. [REQ: Every appended event records when it was emitted, scenario: A producer cannot set its own emission time]
- [x] AC-3: Every line of a multi-event batch is stamped, in non-decreasing order. [REQ: Every appended event records when it was emitted, scenario: Every event of one batch is stamped]
- [x] AC-4: A log of unstamped events replays into the same state as before. [REQ: An event with no emission time is read as unknown, scenario: An older log still replays]
