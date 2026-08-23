## 1. Implement

- [x] 1.1 Add `copilot.pollDwell` to config, defaulting to a value that roughly halves the measured wait, with `0` meaning "as before". [REQ: A poll returns once enough new speech has accumulated]
- [x] 1.2 Add the accumulated-speech condition to `pollDecision`, counting speech lines only and leaving the existing triggers ahead of it. [REQ: A poll returns once enough new speech has accumulated]

## 2. Test

- [x] 2.1 Unit-test: threshold reached returns; below threshold waits; non-speech does not count; zero preserves previous behaviour; an existing trigger still wins. [REQ: A poll returns once enough new speech has accumulated]

## 3. Measure

- [ ] 3.1 Re-run the `reference` scenario in real time and score it. [REQ: A poll returns once enough new speech has accumulated]
- [ ] 3.2 Compare against the baseline WITH the noise band: latency should move well beyond ±2244 ms, and `fillerShare` must not degrade beyond its band. Report both honestly. [REQ: A poll returns once enough new speech has accumulated]

## Acceptance Criteria (from spec scenarios)

- [x] AC-1: Reaching the threshold with new speech ends the poll immediately. [REQ: A poll returns once enough new speech has accumulated, scenario: Accumulated speech ends the wait]
- [x] AC-2: Non-speech lines do not count toward the threshold. [REQ: A poll returns once enough new speech has accumulated, scenario: Non-speech does not count toward the threshold]
- [x] AC-3: A threshold of zero returns only on the previous triggers. [REQ: A poll returns once enough new speech has accumulated, scenario: A threshold of zero preserves the previous behaviour exactly]
- [x] AC-4: A question still returns the poll at once. [REQ: A poll returns once enough new speech has accumulated, scenario: The existing triggers still fire first]
