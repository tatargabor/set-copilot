## MODIFIED Requirements

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
