## REMOVED Requirements

### Requirement: Mirroring is enforced by a Stop hook, not agent discipline

**Reason**: The `Stop` hook is the wrong shape for this job, as a live wall test on 2026-07-29
showed in three ways. It is **late by construction** — it fires after the turn closes, so a line the
operator read in chat waits for every tool call that follows it. It sees only the turn's **last**
text block, so everything said mid-turn is discarded. And it **races the transcript**: it reads the
file at turn end, so it delivers the last block it can see rather than the last block written —
measured, the wall's final mirror event was the message written 37 seconds earlier, while the
message written 0.2 s before the hook ran never appeared. The mirror is therefore permanently one
message behind, and a session's closing message can never be mirrored at all.

None of this was diagnosable from outside: the hook kept no record, and its `|| true` on the emit
plus a de-duplication stamp written *before* delivery meant a failure was simultaneously invisible
and unretryable.

The hook's own reason for existing — that enforcement must be structural, not a prompt mandate the
copilot can fall behind on — is preserved and strengthened, not abandoned: the replacement depends
on neither the model's discipline nor a hook firing.

**Migration**: Mirroring is now delivered by the continuous transcript follower specified in
`mirror-follower`, which keeps the self-gating preconditions (`wall.pid` + `wall-mirror.enabled`),
the same mirror policy, and the same de-duplication, and adds mid-turn delivery, per-message
ordering, a durable offset, and an operations log. `set-copilot init` no longer registers
`wall-mirror.sh` and removes a registration it added previously; the hook script is retired. An
existing project needs no config change — only a re-run of `init`.

## MODIFIED Requirements

### Requirement: Opt-in chat mirroring, off by default

The system SHALL mirror the copilot's substantive chat contributions to a wall text box
ONLY when chat mirroring is explicitly enabled. Mirroring SHALL be disabled by default, so
the chat-primary / wall-secondary separation remains the norm and no chat content reaches
the wall unless an operator opts in.

Enabling SHALL be available at session start (a start-time option in the spirit of the
existing `wall` switch), so an operator opts in for the whole session up front.

Enabling SHALL verify its own precondition: because the mirror is self-gating and therefore silent
when its delivery mechanism is absent, the enable path SHALL confirm that the mechanism is actually
in place before it records the opt-in, and SHALL fail loudly with the command that establishes it
when it is not. An opt-in that can never fire SHALL NOT be recorded as success. This closes the
measured field failure of 2026-07-28, where a marker-based opt-in in a project without the
mechanism produced a wall that stayed empty with no error anywhere. With the follower as the
mechanism, the precondition is that the **follower is running for this runtime dir** — a check that
is strictly more direct than the previous one, which could only confirm that a hook was
*registered*, never that it fired.

#### Scenario: Disabled by default

- **WHEN** the meeting copilot is started without the chat-mirroring option
- **THEN** the copilot's chat contributions SHALL NOT be emitted to any wall box

#### Scenario: Enabled at session start

- **WHEN** the meeting copilot is started with the chat-mirroring option enabled
- **THEN** for the rest of that session the copilot's substantive chat lines SHALL also be
  emitted to the configured wall text box

#### Scenario: Enabling without a working delivery mechanism fails loudly

- **WHEN** the chat-mirroring option is used and the follower is not running for the session
- **THEN** enabling SHALL report the missing follower and the command that starts it, and
  SHALL NOT report mirroring as enabled

### Requirement: Only substantive lines are mirrored, judgement is config-driven

Only substantive contributions SHALL be mirrored, never filler or acknowledgements. What
counts as substantive, and into which box the mirror is routed, SHALL be governed by the
skill mechanics and the project's copilot config — not hard-coded in the engine, consistent
with "everything project-specific is config, not code."

Filler classification SHALL be expressible as a **policy**, not only as a length threshold: a
project SHALL be able to name the progress and acknowledgement phrases it never wants on the
wall ("working on it", "waiting", "listening quietly", and their equivalents in the project's
language), in addition to a minimum length. Defaults SHALL be provided for the project's shipped
languages, in the same manner as the other language-dependent detection seams, and a
user-supplied malformed entry SHALL be dropped with a warning rather than breaking mirroring.

The length budget and the code-block handling SHALL likewise be config, with defaults that preserve
a readable wall. The budget SHALL govern **how a message is divided into events, not how much of it
survives**: a message longer than the budget SHALL be delivered as consecutive events on block
boundaries (specified in `mirror-follower`), so length control never discards content. Measured on
2026-07-29: a 2143-character nine-item report was reduced to 641 characters — one item of nine — by
a cap doing the discarding.

What the policy actually does SHALL be reported to the copilot from the **resolved** configuration,
not restated by hand in the skill or the drawing contract. A restated claim rots: on 2026-07-29 the
skill still taught that the mirror strips code blocks, months after the default became `keep`, so
the copilot sent an ASCII table **unfenced** to survive a stripping that no longer happened — and
the wall rendered it in a proportional font, unreadable, when a fenced block would have rendered as
monospace.

#### Scenario: Filler is not mirrored

- **WHEN** the copilot has no substantive line to contribute (it would otherwise stay silent)
- **THEN** nothing SHALL be mirrored to the wall — silence in chat is silence on the wall

#### Scenario: Routing target is config, not engine

- **WHEN** an operator wants mirrored chat to land in a different existing text box
- **THEN** that routing SHALL be expressible in config without an engine change

#### Scenario: A configured filler phrase is suppressed even when long enough

- **WHEN** a message consists of a progress or acknowledgement phrase the project listed as
  filler, and it exceeds the minimum length
- **THEN** it SHALL NOT be mirrored — the phrase policy SHALL apply independently of length

#### Scenario: A malformed policy entry does not break mirroring

- **WHEN** the configured filler policy contains an entry that cannot be used
- **THEN** that entry SHALL be dropped with a warning and mirroring SHALL continue with the
  remaining policy

#### Scenario: A long message reaches the wall whole

- **WHEN** a message exceeds the length budget
- **THEN** it SHALL be delivered as consecutive events on block boundaries rather than truncated —
  no partial table and no unterminated fence SHALL reach the wall, and no content SHALL be dropped
  merely for being late in the message

#### Scenario: The copilot is told the code-block behaviour that is actually configured

- **WHEN** the copilot reads the mirror contract in a project that keeps code blocks
- **THEN** the contract SHALL say they are kept, derived from the resolved policy, so the copilot
  fences tabular and monospace content instead of working around a stripping that does not happen

#### Scenario: A code block survives to the wall by default

- **WHEN** a mirrored message contains a fenced code block and the project has not configured
  code-block handling
- **THEN** the block SHALL reach the wall and render as a code block
