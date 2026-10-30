## MODIFIED Requirements

### Requirement: Mirroring is delivered by a continuous transcript follower

The system SHALL mirror the copilot's chat to the wall from a long-running **follower** of the
Claude Code session transcript, not from a turn-boundary hook and not from a prompt mandate asking
the copilot to emit the mirror itself. The follower SHALL deliver each new assistant text block as
it is appended to the transcript — during the turn, not at its end — and SHALL deliver **every**
such block in file order, not only the turn's last one.

Only the **main session's** assistant text SHALL be mirrored: transcript entries marked as a
sidechain (a subagent's or fork's own conversation), thinking blocks and tool-use blocks SHALL NOT
reach the wall. The follower SHALL locate the session transcript from an explicit `--transcript`
path when given; otherwise from the session id — `--session`, defaulting to the basename of the
runtime dir, which the skills name after the Claude Code session — first by the projects-directory
naming convention and then by searching every project directory for that id. When none resolves,
the follower SHALL fail with a message naming `--transcript` rather than follow nothing.

The follower SHALL be self-gating: it mirrors only while BOTH a wall is running for the session
(`<runtimeDir>/wall.pid` exists) AND mirroring was opted in for it
(`<runtimeDir>/wall-mirror.enabled` exists). Each message SHALL pass through the project's mirror
policy (length floor, filler suppression, code-block handling, and the chunk budget that divides a
long message) via the same single implementation the rest of the system uses — the follower SHALL
NOT carry its own copy of that judgement — and consecutive identical emissions SHALL be
de-duplicated so a repeat does not double the line.

Enforcement remains structural: delivery depends on neither the model's discipline nor a hook
firing.

#### Scenario: A message is mirrored mid-turn

- **WHEN** the copilot writes a text block and the turn continues with further tool calls
- **THEN** the follower SHALL emit that block to the wall as soon as it appears in the transcript,
  without waiting for the turn to end

#### Scenario: Every text block is mirrored, in order

- **WHEN** a single turn produces several assistant text blocks
- **THEN** each SHALL be mirrored, in the order the transcript records them — not only the last

#### Scenario: Policy is applied by the one implementation

- **WHEN** the follower processes a message
- **THEN** it SHALL obtain the emit/short/filler verdict and the division into chunks from the
  project's mirror policy rather than re-implementing length, filler, or code-block handling

#### Scenario: No wall or no opt-in, no mirroring

- **WHEN** the session has no running wall, or no `wall-mirror.enabled` marker
- **THEN** the follower SHALL emit nothing — the copilot does not emit the mirror itself either, so
  nothing reaches the wall

#### Scenario: The same message is not mirrored twice

- **WHEN** the follower would emit a message identical to the one it last emitted for this session
- **THEN** it SHALL skip it, so a retry or an overlap does not double the line on the wall

#### Scenario: A subagent's text is not mirrored

- **WHEN** a subagent or fork writes an assistant text block into the same session transcript,
  marked as a sidechain
- **THEN** the follower SHALL NOT mirror it

#### Scenario: The transcript is found from the runtime dir's name

- **WHEN** the follower starts with neither `--transcript` nor `--session` in a runtime dir named
  after the Claude Code session
- **THEN** it SHALL use that name as the session id to locate the transcript, and SHALL fail naming
  `--transcript` if no transcript with that id exists

### Requirement: Delivery resumes from a durable offset and never replays history

The follower SHALL persist its read position in the runtime dir (`mirror-offset`), advance it only
after a message has been handed to the wall, and resume from it on restart — so a restarted
follower neither re-mirrors what already went out nor skips what arrived while it was down.

Loss SHALL be preferred over replay in three cases, each of which would otherwise dump history onto
a live wall in front of an audience:

- **No offset recorded yet.** A follower that has never run for this runtime dir SHALL start from
  the **end** of the transcript, not its beginning, and record that position (`init`). Mirroring is
  enabled mid-session as often as at the start, and the transcript may already hold an entire
  session's messages — none of which were wall material when they were written.
- **The transcript is shorter than the recorded offset** (truncated, rotated, or replaced): the
  follower SHALL resume from the **end** of the new file rather than re-delivering stale messages,
  and record the discontinuity (`reset`).
- **The gate is closed.** A message written while no wall is running or no opt-in marker exists is
  not wall material at the time it was written: the follower SHALL advance past it rather than
  queue it, and SHALL NOT mirror it when the gate later opens.

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

#### Scenario: A message written while the gate is closed is never mirrored later

- **WHEN** a message is written while the session has no running wall or no opt-in marker, and the
  gate opens afterwards
- **THEN** the follower SHALL have advanced its offset past that message and SHALL NOT emit it

### Requirement: The mirror records what it decided

The mirror SHALL keep an append-only operations log in the runtime dir (`wall-mirror.log`)
recording, per message it put through the policy, the time, the decision and enough identification
(the transcript entry's uuid) to find the message in the transcript. The decision vocabulary SHALL
be: `emit` (delivered, with its chunk count), `short` (below the length floor), `filler`
(suppressed as filler), `dup` (identical to the last emission), and `error` (the emit or the pass
failed, with its reason); position events SHALL be logged as `init` (first run, started at the end
of the transcript) and `reset` (transcript shorter than the offset). There is no "truncated"
decision: a long message is divided into chunks, never cut. The live log SHALL be bounded by
rotation — once it reaches a fixed line budget it is renamed aside to a timestamped file, never
truncated.

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

#### Scenario: A full log is rotated, not truncated

- **WHEN** the live `wall-mirror.log` reaches its line budget
- **THEN** it SHALL be renamed aside to a timestamped `wall-mirror-<timestamp>.log` and a new live
  log started, with no recorded decision discarded

### Requirement: Monospace-dependent content is fenced by the sender, not by instruction

When code blocks are kept by the mirror policy (`codeBlocks: "keep"`, the default) and a block's
readability depends on column alignment — box-drawing characters, or consistent column positions
across several lines — and it is not already inside a fenced code block, the sender SHALL fence it
before emitting, so the wall renders it in a monospace block. Under `strip` or `collapse` the
sender SHALL NOT add fences, since that configuration has chosen to keep code out of the wall.

This SHALL be a mechanical step in the delivery path, not a rule the copilot is asked to follow.
On 2026-07-29 an ASCII table reached the wall unfenced and rendered in a proportional font,
unreadable, because the copilot was working around a code-block stripping that the configuration no
longer performed. Replacing one piece of prompt discipline (mirror when you remember to) with
another (fence when you remember to) would reproduce the failure this capability exists to end.

#### Scenario: An unfenced ASCII table is fenced before it goes out

- **WHEN** code blocks are kept and a message contains a block of box-drawing characters or
  column-aligned lines outside any fence
- **THEN** the delivery path SHALL wrap that block in a code fence, so the wall renders it monospace

#### Scenario: Already-fenced content is left alone

- **WHEN** the content is already inside a fenced code block
- **THEN** it SHALL be emitted unchanged — no second fence, no re-indentation

#### Scenario: Prose is not fenced

- **WHEN** a block is ordinary prose, a list, or a markdown table
- **THEN** it SHALL NOT be fenced — fencing SHALL apply only where alignment carries meaning

#### Scenario: No fencing when code blocks are not kept

- **WHEN** the mirror policy's `codeBlocks` is `strip` or `collapse`
- **THEN** the sender SHALL NOT fence aligned blocks

## ADDED Requirements

### Requirement: A retired mirror hook registration is removed and reported

The retired `wall-mirror.sh` `Stop` hook SHALL NOT keep running next to the follower: running both
would emit every mirrored line twice, invisibly from the wall. `set-copilot init` SHALL unregister
a `wall-mirror.sh` Stop hook from the settings file it manages and say that it did, and the mirror
diagnostic SHALL warn while such a registration remains anywhere it checks, naming the file.

#### Scenario: Init removes the retired hook

- **WHEN** `set-copilot init` runs against a settings file that still registers `wall-mirror.sh`
  as a Stop hook
- **THEN** the registration SHALL be removed and the removal reported

#### Scenario: The diagnostic warns about a leftover registration

- **WHEN** the operator runs `set-copilot doctor --mirror` while a settings file still registers
  `wall-mirror.sh`
- **THEN** it SHALL warn that the hook would double every mirrored line, naming the settings file
