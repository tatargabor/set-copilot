## 1. Make the registry readable

- [x] 1.1 Add a read-only wall endpoint listing promotable staged predictions with category, visual id, and remaining time, filtered by the same clock the expiry sweep uses. [REQ: What is currently promotable can be asked for]
- [x] 1.2 Prove it is read-only: asking broadcasts nothing, defers no expiry, and changes no state. [REQ: What is currently promotable can be asked for]
- [x] 1.3 Unit-test the listing: staged appears, promoted disappears, expired disappears, empty is empty. [REQ: What is currently promotable can be asked for]

## 2. Expose it to the producer

- [x] 2.1 Add `set-copilot wall-staged`, reading the wall this runtime dir owns. [REQ: What is currently promotable can be asked for]
- [x] 2.2 Report clearly when no wall is running, rather than printing an empty list that reads as "nothing staged". [REQ: What is currently promotable can be asked for]

## 3. Teach the contract

- [x] 3.1 Add the promotion command's shape to the drawing contract's payload shapes. [REQ: The producer is taught how to promote]
- [x] 3.2 State that a staged visual must carry a `visual` id, because the promotion names it. [REQ: The producer is taught how to promote]
- [x] 3.3 State the trigger — the conversation arrived at what the prediction anticipated — and that an unpromoted prediction expiring is correct for a wrong guess, not a miss. [REQ: The producer is taught how to promote]
- [x] 3.4 Point the producer at `wall-staged` so it asks rather than remembers. [REQ: What is currently promotable can be asked for]
- [x] 3.5 Unit-test that the rendered policy carries the command, the id requirement, and the trigger. [REQ: The producer is taught how to promote]

## 4. Measure

- [ ] 4.1 Re-run the `reference` scenario in real time and score it. [REQ: The producer is taught how to promote]
- [ ] 4.2 Report honestly: a prediction reaching the public wall is the claim; with no noise band for this dimension, one run is a reading, not a rate. Check `precision` against its band — a copilot promoting noise would show there. [REQ: The producer is taught how to promote]

## Acceptance Criteria (from spec scenarios)

- [x] AC-1: The rendered policy shows the promotion command's shape. [REQ: The producer is taught how to promote, scenario: The rendered contract carries the command]
- [x] AC-2: The contract states that a staged visual must be identifiable. [REQ: The producer is taught how to promote, scenario: The contract requires a staged visual to be identifiable]
- [x] AC-3: The contract ties promotion to the conversation arriving, and calls expiry correct for a wrong guess. [REQ: The producer is taught how to promote, scenario: The contract states when to promote]
- [x] AC-4: A staged, unexpired, unpromoted prediction is listed with its remaining time. [REQ: What is currently promotable can be asked for, scenario: A staged prediction is listed while it is promotable]
- [x] AC-5: A promoted prediction is no longer listed. [REQ: What is currently promotable can be asked for, scenario: A promoted prediction is no longer listed]
- [x] AC-6: An expired prediction is no longer listed, and asking does not revive it. [REQ: What is currently promotable can be asked for, scenario: An expired prediction is no longer listed]
- [x] AC-7: Asking broadcasts nothing and changes no state. [REQ: What is currently promotable can be asked for, scenario: Asking changes nothing]
