## MODIFIED Requirements

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
