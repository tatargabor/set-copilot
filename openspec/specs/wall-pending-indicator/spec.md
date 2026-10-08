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

A pending marker SHALL carry a zone like any display event, and SHALL be routed by the same
zone gate: a `private` pending marker SHALL NOT reach a public client. The default zone for
a pending marker SHALL be `both`: a placeholder is exactly what a wall must show while its
content is being drawn, and a "drawing…" state that only an operator surface can see is no
placeholder at all on a single-surface wall.

A pending marker whose zone reaches a public client SHALL pass the redaction funnel's
scrutiny like any other payload: its label SHALL be scrubbed by the configured redactor,
and when scrubbing does not clear the match — or the redactor fails — the marker SHALL be
dropped entirely rather than broadcast. Fail-closed withholds; it never publishes. A
`private` marker SHALL keep its raw label, as today.

Captions are producer text, so the policy SHALL require them short, mechanical, and
content-free.

#### Scenario: Private pending stays off the public wall

- **WHEN** a pending marker is emitted with `zone: "private"`
- **THEN** only a private view shows the placeholder; the public wall shows nothing new

#### Scenario: The default placeholder is visible on the wall

- **WHEN** a pending marker is emitted without an explicit zone, and a public-audience wall
  is connected
- **THEN** the wall shows the placeholder — the visible "drawing…" feedback — without the
  producer having to think about zones for a mechanical marker

#### Scenario: A public-reaching label is scrubbed

- **WHEN** a pending marker bound for a public client carries a label matching the
  redaction taxonomy
- **THEN** the label arrives scrubbed on the wire

#### Scenario: A label the redactor withholds drops the marker

- **WHEN** a pending marker's label still matches after scrubbing, or the redactor fails
- **THEN** the marker is not broadcast at all — a vanished spinner is recoverable, a
  published label is not
