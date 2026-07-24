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

- **WHEN** a window declares `layout: "third-two-thirds"` (a layout defining positions `left` and
  `right`) and assigns `left` a text box subscribing to `["riasztás","súgás"]` and `right` a
  presentation box subscribing to `["architektúra","metrika"]`
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
  unchanged

#### Scenario: Slot ignores unsubscribed categories

- **WHEN** an event of category `transzkript` arrives and a box (or its legacy slot) subscribes
  only to `riasztás` and `súgás`
- **THEN** that box SHALL NOT render the event

### Requirement: CSS Grid substrate

The layout engine SHALL use native CSS Grid as its layout mechanism: a *layout* maps to a
`grid-template-areas` together with explicit `grid-template-columns` and `grid-template-rows`
derived from the layout's declared arrangement, and one container element is mounted per box
position. The engine SHALL NOT impose a fixed column count; horizontal, vertical, and mixed
arrangements SHALL all be expressible in config. No UI framework (React/Vue/etc.) SHALL be
required. The only permitted external library is Cytoscape.js, and only for the `graph` render
type.

#### Scenario: A horizontal layout maps to two columns

- **WHEN** a layout declares positions `left` and `right` with proportions one third and two
  thirds
- **THEN** the client generates `gridTemplateColumns: "1fr 2fr"` with a single row and mounts one
  element per position, without instantiating any framework runtime

#### Scenario: The stacked arrangement remains expressible

- **WHEN** a layout declares its positions as a single column stacked top to bottom
- **THEN** the client generates a one-column template equivalent to the previous fixed behavior,
  so the prior arrangement is preserved as a named layout rather than as a hard-coded rule

#### Scenario: Slot config maps to grid template

- **WHEN** the client resolves a legacy slot list with areas `pinned`, `stream`, `canvas` onto
  the stacked layout
- **THEN** it generates a `grid-template-areas` from those areas and mounts one element per
  position, without instantiating any framework runtime

### Requirement: Scroll behavior

A box with `behavior: "scroll"` SHALL accumulate events as an ordered log, keep the newest
visible, and remain scrollable through history.

#### Scenario: Accumulate and autoscroll

- **WHEN** successive `súgás` events arrive in a `scroll` box
- **THEN** each is appended to the log, the newest is scrolled into view, and earlier entries
  remain reachable by scrolling

### Requirement: Latest behavior

A box with `behavior: "latest"` SHALL show only the most recent event for its subscribed
categories; a newer event replaces the currently shown one.

#### Scenario: Replace on newer event

- **WHEN** a `súgás` event is shown in a `latest` box and a newer `súgás` event arrives
- **THEN** the box replaces the shown content with the newer event

### Requirement: Latest behavior with pacing (playout director)

A `latest` box MAY declare `pacing`, turning it into a playout-governed canvas. With pacing, the
box SHALL enforce a minimum dwell time (a shown item stays at least `minDwellMs`), a freshness
gate (a newer candidate is only swapped in after the dwell elapses; if no fresher candidate
exists, the current item is held), and a priority override (a direct command swaps immediately,
bypassing the dwell). Swaps SHALL support a cross-fade transition.

Pacing SHALL be a property of the box, not of the position it occupies: moving a box to a
different position SHALL NOT change its pacing.

#### Scenario: Hold for minimum dwell

- **WHEN** an item is shown in a paced box with `minDwellMs: 10000` and a fresher candidate
  becomes available after 4 seconds
- **THEN** the box keeps showing the current item until at least 10 seconds have elapsed, then
  swaps to the fresher candidate

#### Scenario: Hold when nothing fresher

- **WHEN** the minimum dwell has elapsed but no fresher candidate is available
- **THEN** the box SHALL keep showing the current item until a fresher candidate arrives

#### Scenario: Priority override swaps immediately

- **WHEN** a direct command (priority override) targets a paced box while the current item is
  still within its dwell window
- **THEN** the box SHALL swap to the commanded item immediately, ignoring the remaining dwell

#### Scenario: Pacing follows the box across positions

- **WHEN** a paced presentation box is reassigned from position `right` to position `left`
- **THEN** its dwell and freshness behavior are unchanged

### Requirement: Render types

The display SHALL provide four built-in render types: `text`, `graph`, `chart`, and the
media types `image` and `webpage` introduced by this change.

`text` renders an event into a DOM lane. `graph` renders into a Cytoscape.js instance and SHALL
append incrementally (`cy.add`) for an `add` operation rather than rebuilding the whole graph,
running an animated dagre layout on update. `chart` renders a data series. `image` renders a
local file or remote URL. `webpage` renders an embedded document.

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
- **THEN** the renderer appends the new node and edge to the existing Cytoscape graph (not a full
  rebuild) and runs an animated layout

#### Scenario: Text render into a lane

- **WHEN** a `text` event arrives in a text box
- **THEN** the renderer produces a DOM element for it in that box's lane per the box's behavior
  (scroll or latest)

#### Scenario: An unrenderable payload does not blank the box

- **WHEN** an event carries a payload whose render type cannot be resolved, or whose media source
  fails to load
- **THEN** the box SHALL keep showing its previous content and log a warning, rather than clearing
  to an empty state
