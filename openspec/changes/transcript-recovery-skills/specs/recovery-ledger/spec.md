## ADDED Requirements

### Requirement: A recovery step runs at most once per transcript

The system SHALL record every completed recovery step and SHALL NOT repeat a step already
recorded for the same transcript. The record SHALL be per **transcript and step**, so that
completing one step never marks another as done. Repetition SHALL be possible only through an
explicit override.

#### Scenario: A second run over the same archive does no work

- **WHEN** a batch stitch is run twice over the same directory
- **THEN** the second run reports every input as already done and stitches nothing

#### Scenario: A new file in a processed directory is still stitched

- **WHEN** a directory that was already processed gains a new transcript and is run again
- **THEN** only the new transcript is stitched

#### Scenario: The override redoes the work

- **WHEN** a run is invoked with the force override
- **THEN** the recorded step is performed again and a new record is appended

#### Scenario: One step done does not imply another

- **WHEN** a transcript has been stitched but not reviewed
- **THEN** it is reported as pending review, and a later review runs

### Requirement: The ledger is engine-owned, never prompt-owned

The ledger SHALL be written by the engine as a side effect of performing the step, not by the
caller remembering to record it. A command that performs a step SHALL record it without being
asked. For steps an engine cannot perform itself — a reading pass done by a model — the system
SHALL expose an explicit command to record completion, so the record is still an engine write.

#### Scenario: Stitching records itself

- **WHEN** a transcript is stitched successfully
- **THEN** its stitch step is recorded with no separate instruction to do so

#### Scenario: A model-performed step is recorded through the engine

- **WHEN** a review pass finishes and the caller marks it complete
- **THEN** the engine appends the record, and a subsequent status query reports the review done

#### Scenario: A failed step is not recorded as done

- **WHEN** a step fails or produces no artifacts
- **THEN** no completion is recorded and the transcript stays pending

### Requirement: Recording a completed step SHALL NOT depend on the caller remembering

A step performed by a model is not recorded by the engine observing it, so the system SHALL NOT
rely on the caller choosing to record it afterwards. Three mechanisms SHALL make the record
structural rather than remembered, and the system SHALL provide all three:

1. **The record carries the result.** The completion command SHALL be the channel through which
   the step's output is delivered, so a caller that skips recording also fails to deliver its
   work. There SHALL be no supported path that produces the result without the record.
2. **Starting is visible.** A step SHALL be claimable before it begins, so a step that started
   and never finished is reported as such rather than being indistinguishable from one never
   attempted. A claim SHALL NOT count as completion.
3. **Ending is gated.** An open claim SHALL prevent a session from concluding silently; the
   caller SHALL be required either to record completion or to abandon the claim explicitly.

#### Scenario: The result cannot be delivered without recording it

- **WHEN** a review produces findings
- **THEN** they are submitted through the completion command, so the findings and the record are
  written by the same act

#### Scenario: An abandoned step returns to pending, loudly

- **WHEN** a claimed step is explicitly abandoned
- **THEN** the transcript is reported as pending again, and the abandonment is recorded so the
  history shows it was attempted

#### Scenario: Enforcement is reported when it is not installed

- **WHEN** the gating mechanism is not installed in the environment
- **THEN** the caller is told that completion is not enforced here, rather than the absence being
  silent

### Requirement: A claimed but unfinished step is visible, never silent

The system SHALL report a step that was claimed and neither completed nor abandoned as an
explicit dangling state, distinct from both pending and done. A dangling claim SHALL be
prominent in any status report rather than being folded into the pending count.

#### Scenario: An interrupted review is reported as dangling

- **WHEN** a review was claimed and the session ended without completing or abandoning it
- **THEN** status reports it as claimed-but-unfinished, naming the transcript and when it was
  claimed

#### Scenario: A dangling claim does not block a later attempt

- **WHEN** a transcript with a dangling claim is processed again
- **THEN** the step may be performed and completed, and the dangling claim is resolved

#### Scenario: A dangling claim is not a completion

- **WHEN** a step is claimed but never completed
- **THEN** it is NOT reported as done, and the work is still considered outstanding

### Requirement: Transcripts are identified by content, not by path

A ledger entry SHALL identify its transcript by a fingerprint of the file's content, and MAY
also store the path as a human-readable hint. Recognition SHALL survive the file being renamed,
archived, or copied to another directory, because the handover renames every transcript it
hands over.

#### Scenario: A renamed transcript is still recognised

- **WHEN** a stitched transcript is renamed or moved and processed again
- **THEN** it is reported as already done

#### Scenario: A changed file is a different transcript

- **WHEN** a file with a recorded fingerprint has its content changed and is processed again
- **THEN** it is treated as not yet done

#### Scenario: Two identical copies are one transcript

- **WHEN** the same transcript exists at two paths
- **THEN** processing the second reports it as already done

### Requirement: A ledger entry records the algorithm version it was produced with

Each entry SHALL record the version of the stitch algorithm that produced it. A transcript
processed by an older version SHALL still count as done — the default is never to redo work —
but the system SHALL report how many transcripts were produced by an older version, so the
operator can decide whether to force a re-run.

#### Scenario: An older-version result is not redone silently

- **WHEN** transcripts recorded under an older algorithm version are processed again
- **THEN** nothing is redone, and the report states how many entries predate the current version

#### Scenario: The operator can act on the report

- **WHEN** the operator forces a re-run after seeing that report
- **THEN** those transcripts are reprocessed and recorded against the current version

### Requirement: The ledger is append-only and advisory

The ledger SHALL be append-only: an entry SHALL never be rewritten or deleted in place, so the
history of what ran when survives. A missing, unreadable, or partially written ledger SHALL NOT
fail an operation — it SHALL degrade to treating work as not yet done. Losing the ledger costs
repeated work, never data.

#### Scenario: A corrupt line does not stop the run

- **WHEN** the ledger contains an unparseable line
- **THEN** that line is skipped and the remaining entries are honoured

#### Scenario: A missing ledger means everything is pending

- **WHEN** no ledger exists
- **THEN** every transcript is reported as pending and the run proceeds normally

#### Scenario: History is preserved across re-runs

- **WHEN** a forced re-run records a step that was already recorded
- **THEN** both records remain in the ledger

### Requirement: Recovery state is reportable

The system SHALL expose the recovery state of a set of transcripts: which are pending, which
are done, per step, and which were done under an older algorithm version. The report SHALL be
usable both by an operator reading it and by a skill deciding what work remains.

#### Scenario: Status distinguishes the states

- **WHEN** status is requested for a directory containing an unstitched transcript, a stitched
  but unreviewed one, and a fully recovered one
- **THEN** each is reported under its own state, per step

#### Scenario: Status does not modify anything

- **WHEN** status is requested
- **THEN** no transcript is stitched and no ledger entry is appended
