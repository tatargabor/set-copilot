## ADDED Requirements

### Requirement: Track sizes may be overridden at view time without altering the layout

A viewer SHALL be able to adjust the proportions between a window's regions by dragging the
boundaries between them, and the adjustment SHALL persist for that viewer across reloads
and reconnects.

The adjustment SHALL be a **viewport override**: it changes only the track sizes the window
is rendered with. It SHALL NOT modify the layout definition, SHALL NOT change which
positions exist or where they sit relative to one another, and SHALL NOT alter any box's
behavior, pacing, subscriptions, or policy. The three-layer separation — layout is
geometry, box is content, position binds them — SHALL survive the override intact.

A viewer SHALL be able to discard the override and return to the layout's declared
proportions.

#### Scenario: Dragging a boundary reproportions the regions

- **WHEN** a viewer drags the boundary between two regions
- **THEN** the regions SHALL re-proportion along that axis, and the change SHALL persist
  for that viewer

#### Scenario: An override does not change any box

- **WHEN** a window is displayed with a viewport override in effect
- **THEN** every box SHALL keep the behavior, pacing, subscriptions, and policy its
  configuration declares — the override SHALL affect geometry only

#### Scenario: A layout switch is not defeated by an override

- **WHEN** a window with an override in effect is switched to a different layout
- **THEN** the new layout's declared proportions SHALL apply, since an override belongs to
  the arrangement it was made against

#### Scenario: The override can be discarded

- **WHEN** a viewer resets the adjustment
- **THEN** the window SHALL render with the layout's declared proportions

### Requirement: A graph keeps itself fitted, and a manual scale suspends that

The `graph` render SHALL keep the visual fitted to its region as the visual changes, so a
growing graph does not outgrow its box and a shrinking one does not sit in a corner.

A viewer SHALL be able to set the scale manually. While a manual scale is in effect,
automatic fitting SHALL be suspended — an automatic re-fit SHALL NOT override a viewer's
deliberate choice. Automatic fitting SHALL resume only when the viewer explicitly returns
to it.

#### Scenario: A growing graph stays fitted

- **WHEN** nodes and edges are added to a shown graph over several deltas
- **THEN** the visual SHALL remain fitted within its region without viewer action

#### Scenario: A manual scale is not overridden

- **WHEN** a viewer has set a scale manually and a further delta arrives
- **THEN** the graph SHALL render the new content at the viewer's scale, and SHALL NOT
  re-fit automatically

#### Scenario: Returning to automatic fitting

- **WHEN** a viewer explicitly returns to automatic fitting
- **THEN** the visual SHALL fit to its region again and SHALL resume doing so on subsequent
  changes

#### Scenario: A new visual starts fitted

- **WHEN** a graph reset introduces a new visual
- **THEN** it SHALL be shown fitted, so a new topic is not inherited into a scale chosen for
  the previous one
