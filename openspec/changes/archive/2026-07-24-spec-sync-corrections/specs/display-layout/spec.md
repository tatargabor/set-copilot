## MODIFIED Requirements

### Requirement: Slot-based layout composition

A window SHALL be composed in three declarative layers: **layout → box position → box**.

A *layout* is a named, config-declared template that defines a set of named box positions and
their geometric arrangement (columns, rows, and their proportions). A *box position* is a named
region within a layout. A *box* is a content container assigned to a position, declaring a
`behavior`, an optional `pacing`, the set of category ids it subscribes to, and an optional
box-scoped policy (see `box-policy`).

A window SHALL therefore declare which layout it uses and which box occupies each of that
layout's positions. All three layers SHALL be data-driven, so a window can be recomposed — and a
layout swapped for a differently-shaped one — by changing config, without code changes. Swapping a
layout is a configuration change that takes effect when the wall server (re)starts; live,
no-restart replacement of a running window's layout is not required.

The layer separation is normative: a box position SHALL NOT determine what kind of content a box
holds, and a box SHALL NOT determine its own geometry.

#### Scenario: Compose a window from a layout and boxes

- **WHEN** a window declares `layout: "third-two-thirds"` (the shipped layout defining positions
  `szöveg` and `prezentáció`) and assigns `szöveg` a text box subscribing to `["riasztás","súgás"]`
  and `prezentáció` a presentation box subscribing to `["architektúra","metrika"]`
- **THEN** the display renders two boxes side by side in the declared proportions, each showing
  only events whose category is in that box's subscription list

#### Scenario: The same box definition works in a different layout

- **WHEN** a window's `layout` is changed from `third-two-thirds` to the stacked default, with the
  box assignments otherwise unchanged
- **THEN** the same boxes render in the new geometry without any change to the box definitions

#### Scenario: Box ignores unsubscribed categories

- **WHEN** an event of category `metrika` arrives and a box subscribes only to `riasztás` and
  `súgás`
- **THEN** that box SHALL NOT render the event

#### Scenario: A window naming an unknown layout is rejected, not rendered blank

- **WHEN** a window declares a `layout` id that is not present in the layout registry
- **THEN** the window SHALL be dropped with a warning and the remaining windows SHALL still
  resolve, rather than serving an empty page

#### Scenario: Compose a window from slots

- **WHEN** a window declares the legacy `slots` list `[{area:"pinned", behavior:"latest", cats:["riasztás","súgás"]}, {area:"stream", behavior:"scroll", cats:["transzkript"]}, {area:"canvas", behavior:"latest", pacing:{...}, cats:["architektúra"]}]`
- **THEN** the window SHALL resolve onto the stacked layout — one box per slot area, preserving
  each slot's behavior, pacing, and subscriptions — so an existing slot-based config renders
  unchanged (arbitrary legacy cat ids resolve structurally even when the current registry has no
  such category)

#### Scenario: Slot ignores unsubscribed categories

- **WHEN** an event of category `transzkript` arrives and a box (or its legacy slot) subscribes
  only to `riasztás` and `súgás`
- **THEN** that box SHALL NOT render the event

### Requirement: Render types

The display SHALL provide the built-in render types `text`, `graph`, `chart`, and the media types
`image` and `webpage`.

`text` renders an event into a DOM lane. `graph` renders into a Cytoscape.js instance: on each
`add` delta the renderer SHALL draw the visual's accumulated node/edge set and run an animated
layout (dagre when the plugin is loaded, else breadthfirst). The shipped implementation is the
**A-path** full redraw — it clears the instance (`cy.elements().remove()`) and re-adds the whole
accumulated set on every delta. Incremental append via `cy.add` of only the new node/edge (the
**B-path** optimization) is the intended eventual behavior but is NOT yet implemented; it is
tracked as task 9.13 and SHALL NOT be asserted as current behavior. `chart` renders a data series.
`image` renders a local file or remote URL. `webpage` renders an embedded document.

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
