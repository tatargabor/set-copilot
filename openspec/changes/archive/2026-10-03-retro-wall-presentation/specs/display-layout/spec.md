# Spec Delta

## MODIFIED Requirements

### Requirement: Render types

The display SHALL provide the built-in render types `text`, `graph`, `chart`, and the media types
`image` and `webpage`.

`text` renders an event into a DOM lane. `graph` renders into a Cytoscape.js instance: on each
`add` delta the renderer SHALL draw the visual's accumulated node/edge set and lay it out. The
shipped implementation is the **A-path** full redraw — it clears the instance
(`cy.elements().remove()`) and re-adds the whole accumulated set on every delta. Incremental
append via `cy.add` of only the new node/edge (the **B-path** optimization) is the intended
eventual behavior but is NOT yet implemented; it is tracked as task 9.13 and SHALL NOT be
asserted as current behavior. `chart` renders a data series. `image` renders a local file or
remote URL. `webpage` renders an embedded document.

The graph layout SHALL be chosen per draw:

- When any node of the visual carries numeric `x` and `y`, the nodes SHALL be placed at those
  positions (a preset layout) without animation, and fitted at once while fitting is automatic —
  a board or a matrix needs positions, not a flow layout.
- Otherwise the renderer SHALL run a flow layout (dagre when the plugin is loaded, else
  breadthfirst) whose direction follows the canvas: left-to-right when the canvas is more than
  1.6 times as wide as it is tall, top-down otherwise, so a flow is not drawn against the grain
  and fitted down to a sliver.
- The flow layout SHALL animate only when the visual being drawn is the one drawn last (growth
  of the visual already on screen, where motion carries meaning). A visual drawn for the first
  time, or switched to, SHALL be laid out in place without animation, because animating it from
  a pile at the origin reads as a glitch on a shared screen.

The renderer for a given event SHALL be selected from the event's payload, not from the box's
category subscription. A single box MAY therefore host events of several render types over time,
switching renderer per event.

#### Scenario: One box renders several types in sequence

- **WHEN** a presentation box receives, in order, a `graph` payload, then a `chart` payload, then
  an `image` payload
- **THEN** the box renders each with its own renderer in turn, without any change to the layout or
  the box assignment

#### Scenario: Incremental graph append

- **WHEN** a `graph` event `{op:"add", nodes:[{id:"capture"}], edges:[{source:"mic",target:"capture"}]}`
  arrives in a box currently showing a graph that already contains node `mic`
- **THEN** the renderer draws the visual's full accumulated set (node `mic` plus the new node
  `capture` and the new edge) and runs an animated layout — the shipped A-path full redraw, not an
  incremental `cy.add` of only the new elements (that incremental optimization is tracked as 9.13)

#### Scenario: Text render into a lane

- **WHEN** a `text` event arrives in a text box
- **THEN** the renderer produces a DOM element for it in that box's lane per the box's behavior
  (scroll or latest)

#### Scenario: An unrenderable payload does not blank the box

- **WHEN** an event carries a payload whose render type cannot be resolved, or whose media source
  fails to load
- **THEN** the box SHALL keep showing its previous content and log a warning, rather than clearing
  to an empty state

#### Scenario: Positioned nodes are placed, not laid out

- **WHEN** a graph visual's nodes carry numeric `x`/`y` positions
- **THEN** each node is drawn at its given position, with no animation, and the board is fitted
  in the first frame while fitting is automatic

#### Scenario: A wide canvas draws its flow left to right

- **WHEN** a graph without positions is drawn in a canvas twice as wide as it is tall
- **THEN** the flow layout runs left-to-right; in a canvas of equal width and height it runs
  top-down

#### Scenario: A new visual appears already laid out

- **WHEN** a visual is drawn for the first time
- **THEN** it appears in its laid-out arrangement without an animation from a pile of nodes

### Requirement: A graph keeps itself fitted, and a manual scale suspends that

The `graph` render SHALL keep the visual fitted to its region as the visual changes, so a
growing graph does not outgrow its box and a shrinking one does not sit in a corner.

A viewer SHALL be able to set the scale manually. While a manual scale is in effect,
automatic fitting SHALL be suspended — an automatic re-fit SHALL NOT override a viewer's
deliberate choice. Automatic fitting SHALL resume only when the viewer explicitly returns
to it.

Only a real viewer gesture SHALL switch a visual to manual scale: the zoom buttons, or a zoom or
pan that follows within a moment the viewer's own wheel or pointer input on the canvas and falls
outside the window in which the display is moving the viewport itself. The display's own fits
and layout animations — including the tail of a long animated layout — SHALL NOT be read as the
viewer taking control.

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

#### Scenario: An automatic layout does not take the scale away from automatic

- **WHEN** a large visual is drawn with an animated layout and no viewer input occurs
- **THEN** the visual SHALL remain in automatic fitting after the animation ends, and the next
  delta SHALL be fitted again
