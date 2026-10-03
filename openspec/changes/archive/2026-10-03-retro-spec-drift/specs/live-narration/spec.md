## MODIFIED Requirements

### Requirement: Verbosity is configurable and defaults louder than silent-reactive

How much the copilot narrates SHALL be governed by project configuration rendered into the session policy,
not by logic hard-coded in `src/`. The default SHALL be more talkative than today's reactive silence, and a
project SHALL be able to raise, lower, or disable narration without editing the skill or the engine. The
existing `engagement` setting that governs *chat* about content SHALL remain independent of narration
verbosity.

Disabling narration SHALL remove the narration mandate from the rendered policy; enabling it SHALL only
**append** that mandate — the narration section SHALL NOT perturb the alert, engagement, feedback or
wall-input text that precedes it. Generic turn-order text that mentions narration among the possible
batched emissions MAY remain in the policy when narration is disabled; it gives no mandate to narrate.

#### Scenario: A project tunes narration without forking

- **WHEN** a project sets its narration verbosity (or disables it) in configuration
- **THEN** the rendered policy reflects the setting, and no skill or `src/` change is required

#### Scenario: Narration disabled restores prior behavior

- **WHEN** narration is disabled in configuration
- **THEN** the rendered policy SHALL contain no `## Narration` section and the copilot SHALL emit no
  narration events, so it behaves as the reactive copilot; and the policy rendered with narration enabled
  SHALL begin with exactly the policy rendered with it disabled, the narration mandate only appended
