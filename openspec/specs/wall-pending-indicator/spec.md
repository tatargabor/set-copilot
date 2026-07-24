# wall-pending-indicator

## Purpose

Make a slow, fork-based draw legible instead of indistinguishable from a dead wall: the copilot marks
the target box pending, the box shows a "working" placeholder at once, and the placeholder is cleared
by the real content or by an expiry — respecting the zone model so it never forces internal labels
onto a public wall.

## Requirements

### Requirement: A draw in flight shows an immediate placeholder in its target box

When the copilot starts an out-of-band (fork-based) draw that will take seconds to complete, it SHALL be
able to mark the target box as pending, so the box immediately shows a "working" placeholder — a spinner
or badge with a one-line label describing what is being drawn. This makes a slow draw legible instead of
indistinguishable from a dead wall.

The pending marker is a lightweight signal, not content: it carries the target category and a short label,
never a payload to render as final.

#### Scenario: Placeholder appears before the real draw

- **WHEN** the copilot emits a pending marker for a category, then seconds later emits the real visual
- **THEN** the target box shows the placeholder immediately, and the real visual replaces it when it
  arrives

#### Scenario: Real content clears the placeholder

- **WHEN** a box is showing a pending placeholder and any real payload for that box arrives
- **THEN** the placeholder is removed and the real content is shown

### Requirement: A pending placeholder expires so a dead draw does not strand it

A pending marker SHALL carry (or default to) an expiry. If no real content replaces it within the expiry,
the placeholder SHALL clear itself, so a producer that crashed mid-draw does not leave a permanent spinner
that misrepresents the wall as forever "working".

#### Scenario: Abandoned draw times out

- **WHEN** a pending marker is shown and no real content and no fresh pending marker arrives before the
  expiry elapses
- **THEN** the placeholder clears on its own

### Requirement: Pending markers respect the zone model

A pending marker SHALL carry a zone like any display event, and SHALL be routed by the same zone gate: a
`private` pending marker SHALL NOT reach a public client. A pending placeholder is operator feedback by
default and MUST NOT force internal labels onto the public wall.

#### Scenario: Private pending stays off the public wall

- **WHEN** a pending marker is emitted with `zone: "private"`
- **THEN** only the private view shows the placeholder; the public wall shows nothing new
