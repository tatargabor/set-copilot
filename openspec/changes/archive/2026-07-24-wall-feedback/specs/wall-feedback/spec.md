## ADDED Requirements

### Requirement: Chat is the primary feedback channel; the wall is a secondary artifact

The copilot's primary channel SHALL be its chat output; the wall SHALL be a secondary, polished
visual artifact. The wall SHALL NOT be the sole feedback channel. When the copilot emits a wall
visual (graph, chart, or a wall-only note), it SHALL also surface a brief acknowledgement in chat
stating what it understood or its interpretation — not the raw transcript. When the copilot is
directly addressed, or is actively working, it SHALL give a brief chat acknowledgement rather than
remaining fully silent. The amount of acknowledgement SHALL be config-driven (the `copilot.*` seam),
not hard-coded prose in the skill; the default is narrow (direct address + acknowledging the
copilot's own wall emissions) and MUST NOT change the multi-party category-firing policy.

#### Scenario: A wall visual is mirrored by a chat acknowledgement

- **WHEN** the copilot emits a `metrika` chart to the wall from spoken numbers
- **THEN** it also writes a brief chat line stating what it charted (e.g. which values it read),
  so the wall is never the only signal that the copilot acted

#### Scenario: Direct address is never met with silence

- **WHEN** the mic speaker directly addresses the copilot (e.g. asks whether it heard them, or asks
  it to produce a diagram)
- **THEN** the copilot gives a brief chat acknowledgement rather than staying fully silent, even if
  no alert category fires

#### Scenario: Multi-party category policy is unchanged

- **WHEN** two parties are talking and nothing is directed at the copilot and no category fires
- **THEN** the copilot stays silent as before — the feedback opening applies only to direct address
  and to acknowledging its own wall emissions, not to general conversation

### Requirement: Uncertain interpretation is confirmed in chat, not asserted on the wall

When an extraction is ambiguous, the copilot SHALL state its assumption in chat or ask for
confirmation before (or while) presenting it on the wall; it SHALL NOT present a guessed value on the
wall as if it were established fact. If it does render a provisional visual, the accompanying chat
line SHALL flag the assumption.

#### Scenario: Ambiguous numbers are flagged

- **WHEN** the speech implies numbers only relatively (e.g. "four times this" / "half of this year")
  and the base is ambiguous
- **THEN** the copilot states in chat how it interpreted the numbers (or asks), rather than emitting
  a chart of concrete values with no indication that they were inferred
