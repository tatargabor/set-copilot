## MODIFIED Requirements

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
