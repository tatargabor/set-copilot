## ADDED Requirements

### Requirement: A window's audience is declared, not inferred, and defaults to public

Whether a display surface is public SHALL be an explicit property of the window, and every
public-zone protection — redaction, the zone-appropriate accumulation slice used for
replay, the zoning of `show` commands, and private-only markers — SHALL key off that
property.

The resolution SHALL fail closed: a window that declares no audience, or an audience that
cannot be understood, SHALL be treated as **public**. Widening what a window displays SHALL
NOT be able to disable its public-zone protections as a side effect.

Where a window's declared audience and its zone filter disagree in a way that would
previously have disabled protection, resolution SHALL warn, and SHALL resolve toward the
protected reading.

#### Scenario: An unreadable audience resolves to public

- **WHEN** a window is resolved whose audience declaration is missing or malformed
- **THEN** it SHALL be treated as a public surface, with redaction and every other
  public-zone protection in force

#### Scenario: Widening a window's zones does not disable redaction

- **WHEN** a window declared as a public surface has its zone filter widened
- **THEN** redaction SHALL continue to apply to everything that reaches it, and the window
  SHALL NOT be reclassified as private as a consequence of its zone list

#### Scenario: A disagreement is reported

- **WHEN** a window's zone filter and its declared audience disagree
- **THEN** resolution SHALL warn, naming the window, and SHALL apply the protected reading
  rather than the permissive one

### Requirement: A public surface never receives private-zone events

A window resolved as a public surface SHALL NOT receive events zoned `private`, under any
zone-filter configuration. `zone: "private"` SHALL remain the only reliable way to keep
content off a public wall, and no configuration SHALL be able to route a private event onto
a public surface — not even through redaction, which is a shape-matcher and not a
classifier.

Making content publicly visible SHALL therefore be done by emitting it to a shared zone, so
that it passes through redaction, and never by widening a public surface's zone filter.

#### Scenario: A private event cannot be configured onto a public wall

- **WHEN** a window resolved as a public surface has `private` in its zone filter and a
  private-zone event is broadcast
- **THEN** the event SHALL NOT reach that window's clients

#### Scenario: Shared-zone content reaches a public surface through redaction

- **WHEN** an event intended for the audience is emitted to a shared zone
- **THEN** it SHALL reach the public surface, having passed through redaction exactly as
  any other public-zone event

#### Scenario: Parity does not mean a private feed

- **WHEN** a public wall is configured to carry the same box set as the private view
- **THEN** those boxes SHALL show only the shared- and public-zone events for their
  categories — the same boxes, not the same feed
