## MODIFIED Requirements

### Requirement: Recording a completed step SHALL NOT depend on the caller remembering

A step performed by a model is not recorded by the engine observing it, so the system SHALL NOT
rely on the caller choosing to record it afterwards. Three mechanisms SHALL make the record
structural rather than remembered, and the system SHALL provide all three:

1. **The record requires the result.** The completion command SHALL refuse to record a completion
   unless it is handed the step's result — for a review, its findings as a JSON array (an empty
   array is the valid result "nothing was missed"), from a file or standard input. The ledger
   SHALL record the result's size (the number of findings), not its content: the findings
   themselves belong to the caller's notes, not to the ledger. There SHALL be no supported path
   that records a completion without a result having been produced.
2. **Starting is visible.** A step SHALL be claimable before it begins, so a step that started
   and never finished is reported as such rather than being indistinguishable from one never
   attempted. A claim SHALL NOT count as completion.
3. **Ending is gated, boundedly.** An open claim SHALL block the end of the session, feeding back
   the open claims and both ways to resolve them (record completion or abandon). The block SHALL
   be bounded: after three blocks the session SHALL be allowed to end with a loud warning, and
   the claim SHALL stay open — the gate SHALL NEVER resolve a claim on the caller's behalf,
   because asserting a review that did not happen is the one failure that loses knowledge
   silently.

#### Scenario: The result cannot be delivered without recording it

- **WHEN** a review produces findings
- **THEN** they are submitted through the completion command, which records the completion with
  the number of findings; and a completion command given no result, or a result that is not a
  JSON array, SHALL exit non-zero and record nothing

#### Scenario: An abandoned step returns to pending, loudly

- **WHEN** a claimed step is explicitly abandoned
- **THEN** the transcript is reported as pending again, and the abandonment is recorded so the
  history shows it was attempted

#### Scenario: Enforcement is reported when it is not installed

- **WHEN** the gating mechanism is not installed in the environment
- **THEN** the caller is told that completion is not enforced here, rather than the absence being
  silent

#### Scenario: The gate gives up loudly, never silently

- **WHEN** a claim is still open after the session end has been blocked three times
- **THEN** the session SHALL be allowed to end with a warning naming the open claims, and those
  claims SHALL remain open and reported by the recovery status
