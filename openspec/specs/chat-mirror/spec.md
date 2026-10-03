# chat-mirror Specification

## Purpose
Mirror the copilot's substantive chat contributions onto a wall text box, so an audience watching
the wall sees what the operator reads in chat — without eroding the chat-primary / wall-secondary
separation. Mirroring is opt-in per session and off by default, is enforced structurally by a
`Stop` hook rather than by prompt discipline, reuses the existing `text` render, and passes through
the same server-side `ingest` redaction as any other event.

## Requirements
### Requirement: Mirroring is enforced by a Stop hook, not agent discipline

Mirroring SHALL be enforced by a `Stop` hook that runs at the end of every turn and emits the
copilot's last message to the wall — NOT by a prompt mandate asking the copilot to emit the
mirror itself. A field meeting proved a prompt-only mandate falls behind (the chat carried far
more than the wall), so the enforcement SHALL be structural.

The hook SHALL be self-gating: it does nothing unless BOTH a wall is running for the session
(`<runtimeDir>/wall.pid` exists) AND mirroring was opted in for it (`<runtimeDir>/wall-mirror.enabled`
marker exists). It SHALL apply the project's mirror **policy** — filler suppression, length cap,
and code-block handling — rather than carrying those decisions in the hook itself, and it SHALL
de-duplicate consecutive identical emissions so repeats do not reach the wall.
`set-copilot init` SHALL install the hook.

Code blocks SHALL NOT be unconditionally discarded. What happens to them SHALL be a policy
decision, and the default SHALL retain them, because a coding copilot's message is largely code
and stripping it defeats the purpose of mirroring.

#### Scenario: The hook mirrors the last message when opted in

- **WHEN** a turn ends in a session that has a running wall and the opt-in marker
- **THEN** the hook SHALL emit the turn's last assistant message to the wall as a mirror event,
  after applying the project's mirror policy and skipping it entirely if the policy classifies it
  as filler

#### Scenario: No marker, no mirroring

- **WHEN** a turn ends in a session without the `wall-mirror.enabled` marker (the default)
- **THEN** the hook SHALL do nothing — the copilot does not emit the mirror itself either, so
  nothing reaches the wall

#### Scenario: The same message is not mirrored twice

- **WHEN** the hook would emit a message identical to the one it last emitted for this session
- **THEN** it SHALL skip it, so a re-run or overlap does not double the line on the wall

#### Scenario: A code block survives to the wall by default

- **WHEN** a mirrored message contains a fenced code block and the project has not configured
  code-block handling
- **THEN** the block SHALL reach the wall and render as a code block

### Requirement: Opt-in chat mirroring, off by default

The system SHALL mirror the copilot's substantive chat contributions to a wall text box
ONLY when chat mirroring is explicitly enabled. Mirroring SHALL be disabled by default, so
the chat-primary / wall-secondary separation remains the norm and no chat content reaches
the wall unless an operator opts in.

Enabling SHALL be available at session start (a start-time option in the spirit of the
existing `wall` switch), so an operator opts in for the whole session up front.

Enabling SHALL verify its own precondition: because the hook is self-gating and therefore
silent when unregistered, the enable path SHALL confirm that the `Stop` hook is registered
before it records the opt-in, and SHALL fail loudly with the installing command when it is
not. An opt-in that can never fire SHALL NOT be recorded as success. This closes the
measured field failure of 2026-07-28, where a marker-based opt-in in a project without the
hook produced a wall that stayed empty with no error anywhere.

#### Scenario: Disabled by default

- **WHEN** the meeting copilot is started without the chat-mirroring option
- **THEN** the copilot's chat contributions SHALL NOT be emitted to any wall box

#### Scenario: Enabled at session start

- **WHEN** the meeting copilot is started with the chat-mirroring option enabled
- **THEN** for the rest of that session the copilot's substantive chat lines SHALL also be
  emitted to the configured wall text box

#### Scenario: Enabling without a registered hook fails loudly

- **WHEN** the chat-mirroring option is used in an environment where the `Stop` hook is not
  registered
- **THEN** enabling SHALL report the missing hook and the command that installs it, and
  SHALL NOT report mirroring as enabled

### Requirement: Mirrored content reuses an existing text box and the redaction funnel

Mirrored chat SHALL be emitted to an existing wall text box — reusing the existing `text`
render, introducing no new render type and no new box kind — and SHALL pass through the same
server-side `ingest` redaction as any other emitted event. A public wall SHALL therefore
never receive mirrored content that has not been through public-zone redaction.

#### Scenario: Reuses the text render

- **WHEN** a chat line is mirrored to the wall
- **THEN** it SHALL render through the existing `text` render in the target box, requiring no
  new render type or engine change

#### Scenario: Redaction applies to mirrored content

- **WHEN** a mirrored line is destined for the public zone and matches a redaction pattern (or
  fails redaction for any reason)
- **THEN** the server SHALL redact or withhold it exactly as it would any other public-zone
  event, fail-closed — the mirroring path SHALL NOT bypass `ingest`

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

The length cap and the code-block handling SHALL likewise be config, with defaults that preserve
a readable wall.

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
