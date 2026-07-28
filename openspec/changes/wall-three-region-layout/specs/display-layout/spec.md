## ADDED Requirements

### Requirement: A layout position occupying several cells SHALL be a rectangle

A position name appearing in more than one cell of a layout's grid SHALL occupy a
rectangular region. A layout in which any position's cells do not form a rectangle SHALL be
rejected at resolution time with a warning naming the offending position, and the window
SHALL be dropped — consistent with the existing posture that a window which cannot be
rendered is dropped with a reason rather than served blank.

This validation SHALL run before the layout reaches the client, because a non-rectangular
arrangement is rejected wholesale by the grid substrate: the result is not a partially
broken layout but a page with no layout at all, and an empty page and a broken page look
identical to the operator.

#### Scenario: A non-rectangular position is rejected with a reason

- **WHEN** a layout declares a position whose cells form an L-shape or a diagonal (for
  example rows `["a","b"]` and `["b","a"]`)
- **THEN** resolution SHALL warn, naming the offending position and layout, and SHALL drop
  the window — the remaining windows SHALL still resolve

#### Scenario: A valid multi-row span resolves

- **WHEN** a layout declares a position occupying the same column in every row (a column
  spanning the full height) alongside positions that differ per row
- **THEN** the layout SHALL resolve and the spanning position SHALL render as one region
  across those rows

#### Scenario: Single-cell positions are unaffected

- **WHEN** every position in a layout occupies exactly one cell
- **THEN** the validation SHALL pass, and every previously valid layout SHALL continue to
  resolve unchanged

### Requirement: The default wall offers a pinned region the stream cannot displace

The shipped wall SHALL provide a region for reference content that remains visible
independently of the live message stream: content placed there SHALL stay until it is
explicitly replaced, and no volume of streamed events SHALL scroll it away, shrink it, or
push it out of view.

The region SHALL be expressed with the existing composition layers — a named layout
position holding a box whose behavior already provides replace-on-newer semantics. No new
behavior kind and no new render type SHALL be introduced for it.

What belongs in the region SHALL be governed by that box's policy, not by the engine,
consistent with "judgement is config, mechanics are code".

#### Scenario: Streamed events do not displace pinned content

- **WHEN** reference content is shown in the pinned region and the stream box then receives
  a long run of events
- **THEN** the pinned content SHALL remain visible and unchanged, and the stream SHALL
  scroll only within its own region

#### Scenario: Pinned content is replaced explicitly

- **WHEN** new reference content is emitted for the pinned region
- **THEN** it SHALL replace the region's content in full, rather than being appended to it

#### Scenario: The region is composed from existing layers

- **WHEN** the pinned region is defined
- **THEN** it SHALL be a layout position with an assigned box, so it can be moved to a
  different position, or omitted from a window, purely by configuration
