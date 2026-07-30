## ADDED Requirements

### Requirement: Mirroring is delivered by a continuous transcript follower

The system SHALL mirror the copilot's chat to the wall from a long-running **follower** of the
Claude Code session transcript, not from a turn-boundary hook and not from a prompt mandate asking
the copilot to emit the mirror itself. The follower SHALL deliver each new assistant text block as
it is appended to the transcript — during the turn, not at its end — and SHALL deliver **every**
such block in file order, not only the turn's last one.

The follower SHALL be self-gating in the same way the hook was: it mirrors only while BOTH a wall
is running for the session (`<runtimeDir>/wall.pid` exists) AND mirroring was opted in for it
(`<runtimeDir>/wall-mirror.enabled` exists). Each message SHALL pass through the project's mirror
policy (filler suppression, length cap, code-block handling) via the same single implementation the
rest of the system uses — the follower SHALL NOT carry its own copy of that judgement — and
consecutive identical emissions SHALL be de-duplicated so a repeat does not double the line.

Enforcement remains structural, and strictly more so than before: delivery depends on neither the
model's discipline nor a hook firing.

#### Scenario: A message is mirrored mid-turn

- **WHEN** the copilot writes a text block and the turn continues with further tool calls
- **THEN** the follower SHALL emit that block to the wall as soon as it appears in the transcript,
  without waiting for the turn to end

#### Scenario: Every text block is mirrored, in order

- **WHEN** a single turn produces several assistant text blocks
- **THEN** each SHALL be mirrored, in the order the transcript records them — not only the last

#### Scenario: Policy is applied by the one implementation

- **WHEN** the follower processes a message
- **THEN** it SHALL obtain the emit/suppress/truncate decision from the project's mirror policy
  rather than re-implementing filler, length, or code-block handling

#### Scenario: No wall or no opt-in, no mirroring

- **WHEN** the session has no running wall, or no `wall-mirror.enabled` marker
- **THEN** the follower SHALL emit nothing — the copilot does not emit the mirror itself either, so
  nothing reaches the wall

#### Scenario: The same message is not mirrored twice

- **WHEN** the follower would emit a message identical to the one it last emitted for this session
- **THEN** it SHALL skip it, so a retry or an overlap does not double the line on the wall

### Requirement: Delivery resumes from a durable offset and never replays history

The follower SHALL persist its read position in the runtime dir (`mirror-offset`), advance it only
after a message has been handed to the wall, and resume from it on restart — so a restarted
follower neither re-mirrors what already went out nor skips what arrived while it was down.

Loss SHALL be preferred over replay in two cases, both of which would otherwise dump history onto
a live wall in front of an audience, and both of which the follower SHALL record:

- **No offset recorded yet.** A follower that has never run for this runtime dir SHALL start from
  the **end** of the transcript, not its beginning. Mirroring is enabled mid-session as often as
  at the start, and the transcript may already hold an entire session's messages — none of which
  were wall material when they were written.
- **The transcript is shorter than the recorded offset** (truncated, rotated, or replaced): the
  follower SHALL resume from the **end** of the new file rather than re-delivering stale messages.

#### Scenario: A restart continues where it left off

- **WHEN** the follower is restarted for a session it was already following
- **THEN** it SHALL resume from its recorded offset, mirroring messages appended while it was down
  and re-mirroring none of the earlier ones

#### Scenario: Enabling mirroring mid-session does not replay the session

- **WHEN** a follower starts for a runtime dir it has never run for, and the transcript already
  holds earlier messages
- **THEN** it SHALL record the end of the transcript as its position, emit nothing retroactively,
  and mirror only what is written from then on

#### Scenario: A truncated transcript does not flood the wall

- **WHEN** the transcript file is shorter than the recorded offset
- **THEN** the follower SHALL resume from the end of the file, mirror nothing retroactively, and
  record the discontinuity in its log

### Requirement: One follower per runtime dir, stopped with the session

At most one follower SHALL run for a given runtime dir. A start attempt while a live follower owns
the dir SHALL be refused rather than overwriting its PID file — the same rule, for the same reason,
as a second capture: an orphaned follower keeps emitting with nothing able to stop it. A PID file
whose process is gone SHALL be reclaimed rather than treated as live.

`set-copilot stop` SHALL stop the follower along with the capture, and the runtime-repair path
SHALL report an orphaned follower PID as it does an orphaned capture PID.

#### Scenario: A second follower is refused

- **WHEN** a follower is started for a runtime dir whose `mirror.pid` names a live process
- **THEN** the start SHALL be refused with a message naming the running follower, and the existing
  PID file SHALL NOT be overwritten

#### Scenario: A stale PID file is reclaimed

- **WHEN** a follower is started for a runtime dir whose `mirror.pid` names a process that no
  longer exists
- **THEN** the new follower SHALL take ownership of the dir

#### Scenario: Stop stops the follower

- **WHEN** the session is stopped
- **THEN** the follower SHALL terminate and remove its PID file

### Requirement: The mirror records what it decided

The mirror SHALL keep an append-only operations log in the runtime dir (`wall-mirror.log`)
recording, per message it considered, the time, the decision (emitted, suppressed as filler,
duplicate, truncated, error) and enough identification to find the message in the transcript. The
log SHALL be bounded in size so a long session cannot fill the disk.

Diagnostics SHALL report mirror readiness as a resolvable state rather than a guess: whether a wall
is running, whether mirroring is opted in, whether the follower process is alive, and when it last
emitted. "The mirror decided not to send this" and "the mirror never ran" SHALL be distinguishable
from outside the process — on 2026-07-29 they were not, and a silently stopped mirror cost a live
session its two most valuable messages with nothing on disk to explain it.

#### Scenario: A suppressed message is still recorded

- **WHEN** the policy classifies a message as filler and nothing is emitted
- **THEN** the log SHALL record the suppression, so the absence on the wall is explained

#### Scenario: Diagnostics report the last emission

- **WHEN** the operator runs the mirror diagnostic
- **THEN** it SHALL report whether the follower is alive and when it last emitted, so a mirror that
  stopped is visible without reading the wall's event log

#### Scenario: A dead follower is reported, not inferred

- **WHEN** mirroring is opted in and a wall is running, but no follower process is alive
- **THEN** the diagnostic SHALL say so and name the command that starts it

### Requirement: A long message is chunked on block boundaries, not truncated away

A message longer than the per-event budget SHALL be delivered as **several consecutive mirror
events**, each carrying whole blocks, in order — not as one truncated event. The scrolling text box
accumulates them, so the whole message reaches the wall with its structure intact.

Truncation of the *message* SHALL NOT be the mechanism for length control. Measured on
2026-07-29: the operator's nine-item field report was 2143 characters and the policy returned 641 —
**one item of nine**, cut mid-sentence. A cap that silently discards seven eighths of the most
valuable message of a session is not a readability protection.

A cut SHALL never fall inside a table or a fenced code block, in either direction: because the wall
renders a closed markdown subset, half a table renders as debris and an unterminated fence swallows
the rest of the box. A single block that alone exceeds the budget SHALL be cut as a last resort,
with its fence closed if it is a code block, and SHALL mark that it was cut.

#### Scenario: A long structured message arrives whole

- **WHEN** a mirrored message is several times the per-event budget and consists of a heading and
  nine list items
- **THEN** every item SHALL reach the wall, across consecutive mirror events, each event containing
  whole blocks

#### Scenario: A chunk boundary never splits a table or a fence

- **WHEN** the budget would be reached in the middle of a table or a fenced code block
- **THEN** the boundary SHALL move to the block's edge — no partial table and no unterminated fence
  SHALL be emitted

#### Scenario: An oversized single block is cut, and says so

- **WHEN** one block alone exceeds the budget
- **THEN** it SHALL be cut, marked as cut, and — if it is a code block — emitted with its fence
  closed

#### Scenario: Chunks stay in order and are not interleaved

- **WHEN** a long message is chunked while the next message is already in the transcript
- **THEN** all chunks of the earlier message SHALL be emitted before the later message

### Requirement: Monospace-dependent content is fenced by the sender, not by instruction

When a block's readability depends on column alignment — box-drawing characters, or consistent
column positions across several lines — and it is not already inside a fenced code block, the
sender SHALL fence it before emitting, so the wall renders it in a monospace block.

This SHALL be a mechanical step in the delivery path, not a rule the copilot is asked to follow.
On 2026-07-29 an ASCII table reached the wall unfenced and rendered in a proportional font,
unreadable, because the copilot was working around a code-block stripping that the configuration no
longer performed. Replacing one piece of prompt discipline (mirror when you remember to) with
another (fence when you remember to) would reproduce the failure this capability exists to end.

#### Scenario: An unfenced ASCII table is fenced before it goes out

- **WHEN** a message contains a block of box-drawing characters or column-aligned lines outside any
  fence
- **THEN** the delivery path SHALL wrap that block in a code fence, so the wall renders it monospace

#### Scenario: Already-fenced content is left alone

- **WHEN** the content is already inside a fenced code block
- **THEN** it SHALL be emitted unchanged — no second fence, no re-indentation

#### Scenario: Prose is not fenced

- **WHEN** a block is ordinary prose, a list, or a markdown table
- **THEN** it SHALL NOT be fenced — fencing SHALL apply only where alignment carries meaning

### Requirement: Delivery latency is bounded, and its floor is stated honestly

A message SHALL leave for the wall within a bounded delay of appearing in the transcript — the
follower SHALL poll continuously rather than waiting on any turn, tool, or session boundary, and
SHALL NOT batch messages to accumulate them. The budget SHALL be **500 ms or less** from the
transcript append to the wall event being written, and it SHALL be measured rather than asserted:
the operator's stated acceptance bar is "near-zero difference between appearing in Claude Code and
appearing on the wall", and a bound nobody measured is not a bound.

The contract SHALL be honest about what it cannot do: the session transcript records **complete
messages, not tokens**, so the wall receives a block when the copilot finishes writing it, while
the chat has been rendering it progressively. That difference is the floor of this mechanism, and
the documentation SHALL state it rather than implying token-level parity.

#### Scenario: A message is not held for the turn boundary

- **WHEN** a message is appended to the transcript and the turn then runs for a further minute
- **THEN** the message SHALL have been emitted to the wall within the follower's bounded delay, not
  at the end of the turn

#### Scenario: The latency floor is documented

- **WHEN** an operator reads what the mirror guarantees
- **THEN** it SHALL state that delivery is per completed message, not per token, so a difference
  from the chat's progressive rendering is expected rather than a defect

#### Scenario: The bound is verified by measurement

- **WHEN** the delivery path is changed
- **THEN** the transcript-append-to-wall-event delay SHALL be measured over a sample of real
  messages and reported, not assumed

### Requirement: Delivery is confirmed before it is forgotten

The follower SHALL treat a message as delivered only when the wall emit has **succeeded**. The read
offset and the de-duplication stamp SHALL both advance after that confirmation, never before, and a
failed emit SHALL be logged with its error and retried rather than swallowed.

This closes a defect in the mechanism being replaced: the hook wrote its de-duplication stamp
*before* emitting, and emitted with the error discarded (`|| true`). A failed emit was therefore
both invisible and permanently de-duplicated — the message could never be retried, because the
stamp already claimed it had gone out.

#### Scenario: A failed emit is retried, not lost

- **WHEN** the wall emit fails for a message (the wall is unreachable, the write errors)
- **THEN** the follower SHALL log the failure, leave the offset and the stamp unadvanced, and retry

#### Scenario: An emit failure is never silent

- **WHEN** an emit fails
- **THEN** the failure and its reason SHALL appear in the mirror log — an emit error SHALL NOT be
  discarded

### Requirement: The session's closing message is mirrored before the wall goes down

Stopping a session SHALL mirror what is still pending before the wall is stopped. The closing
summary is the single most valuable thing a wall can hold — it is the artifact an audience reads
last — and today it can never appear: it is produced in the same turn that stops the wall, so by the
time any mirror path sees it, the wall is gone.

The stop path SHALL therefore drain the follower (deliver what the transcript already holds) before
the wall is taken down, and SHALL report anything it could not deliver rather than exiting as if it
had.

#### Scenario: The closing summary reaches the wall

- **WHEN** a session is stopped after the copilot writes its closing summary
- **THEN** that summary SHALL be mirrored before the wall stops

#### Scenario: An undeliverable pending message is reported

- **WHEN** the stop path cannot deliver a pending message (the wall already died)
- **THEN** it SHALL say so, naming what was not delivered, rather than reporting a clean stop

### Requirement: The follower cannot bypass redaction

The follower SHALL emit through the same wall event funnel as every other producer, so public-zone
redaction runs server-side on mirrored content exactly as it does on any other event. The follower
SHALL NOT gain a direct write path to a client, and SHALL NOT resolve redaction itself.

#### Scenario: Mirrored content is redacted server-side

- **WHEN** a mirrored message destined for the public zone matches a redaction pattern, or
  redaction fails for any reason
- **THEN** the server SHALL redact or withhold it fail-closed, exactly as for any other event — the
  follower's path SHALL NOT be a way around it
