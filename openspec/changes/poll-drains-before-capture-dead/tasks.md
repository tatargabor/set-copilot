## 1. Fix

- [x] 1.1 In `runPoll`, replace the immediate return on a dead capture with a drain: read, filter, deliver the remaining unread lines, and advance the offset through the existing batch path. [REQ: The end of a capture never discards unread lines]
- [x] 1.2 Report `capture-dead` only when nothing remains past the consumer's offset. [REQ: The end of a capture never discards unread lines]

## 2. Tests

- [x] 2.1 Extract the poll's decision — given liveness, the lines on disk, and the offset, what does this poll return — into a pure function so it can be asserted without timers or processes. [REQ: A poll returns the lines written since the consumer last read]
- [x] 2.2 Unit-test the drain: unread lines delivered before the notice; the notice on the following poll; immediate notice when nothing is unread; no double delivery. [REQ: The end of a capture never discards unread lines]
- [x] 2.3 Unit-test that the live-capture behaviour is unchanged: delivery once, empty batch when quiet, early return on question and on direct address. [REQ: A poll returns the lines written since the consumer last read] [REQ: A poll returns early on a line that should not wait]

## 3. Verify

- [x] 3.1 Reproduce the original failure against the fixed build with the replay harness: play a scenario to completion, then poll, and confirm every line is delivered before `capture-dead`. [REQ: The end of a capture never discards unread lines]
- [x] 3.2 Confirm a live capture + poll session is unchanged end to end. [REQ: A poll returns the lines written since the consumer last read]

## Acceptance Criteria (from spec scenarios)

- [x] AC-1: Polling a dead capture with unread lines returns those lines and advances the offset. [REQ: The end of a capture never discards unread lines, scenario: Unread lines are delivered before the death notice]
- [x] AC-2: The following poll reports the capture dead, so a consumer loop still terminates. [REQ: The end of a capture never discards unread lines, scenario: The death notice follows, not replaces, the content]
- [x] AC-3: A dead capture with nothing unread reports death immediately. [REQ: The end of a capture never discards unread lines, scenario: A capture that ends with nothing unread reports death at once]
- [x] AC-4: Drained lines are never delivered a second time. [REQ: The end of a capture never discards unread lines, scenario: A drained batch is not delivered twice]
- [x] AC-5: A question appended during a wait still returns the poll at once. [REQ: A poll returns early on a line that should not wait, scenario: A question does not wait out the poll]
