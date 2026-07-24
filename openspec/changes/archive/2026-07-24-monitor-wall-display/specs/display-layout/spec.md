## ADDED Requirements

### Requirement: Slot-based layout composition

A window's layout SHALL be a declarative composition of slots. Each slot declares an
`area` (position), a `behavior`, and the set of category ids it subscribes to. The
layout SHALL be data-driven so a window can be recomposed by changing the slot list,
without code changes.

#### Scenario: Compose a window from slots

- **WHEN** a window declares slots `[{area:"pinned", behavior:"latest", cats:["riasztás","súgás"]}, {area:"stream", behavior:"scroll", cats:["transzkript"]}, {area:"canvas", behavior:"latest", pacing:{...}, cats:["architektúra"]}]`
- **THEN** the display renders three slots in their declared areas, each showing only
  events whose category is in that slot's subscription list

#### Scenario: Slot ignores unsubscribed categories

- **WHEN** an event of category `transzkript` arrives and a slot subscribes only to
  `riasztás` and `súgás`
- **THEN** that slot SHALL NOT render the event

### Requirement: CSS Grid substrate

The layout engine SHALL use native CSS Grid as its layout mechanism: the slot list maps
to `grid-template-areas` and one container element per slot. No UI framework
(React/Vue/etc.) SHALL be required. The only permitted external library is Cytoscape.js,
and only for the `graph` render type.

#### Scenario: Slot config maps to grid template

- **WHEN** the client receives a slot layout with areas `pinned`, `stream`, `canvas`
- **THEN** it generates a `grid-template-areas` from the slot areas and mounts one
  element per slot, without instantiating any framework runtime

### Requirement: Scroll behavior

A slot with `behavior: "scroll"` SHALL accumulate events as an ordered log, keep the
newest visible, and remain scrollable through history.

#### Scenario: Accumulate and autoscroll

- **WHEN** successive `transzkript` events arrive in a `scroll` slot
- **THEN** each is appended to the log, the newest is scrolled into view, and earlier
  entries remain reachable by scrolling

### Requirement: Latest behavior

A slot with `behavior: "latest"` SHALL show only the most recent event for its
subscribed categories; a newer event replaces the currently shown one.

#### Scenario: Replace on newer event

- **WHEN** a `súgás` event is shown in a `latest` slot and a newer `súgás` event arrives
- **THEN** the slot replaces the shown content with the newer event

### Requirement: Latest behavior with pacing (playout director)

A `latest` slot MAY declare `pacing`, turning it into a playout-governed canvas. With
pacing, the slot SHALL enforce a minimum dwell time (a shown item stays at least
`minDwellMs`), a freshness gate (a newer candidate is only swapped in after the dwell
elapses; if no fresher candidate exists, the current item is held), and a priority
override (a direct command swaps immediately, bypassing the dwell). Swaps SHALL support
a cross-fade transition.

#### Scenario: Hold for minimum dwell

- **WHEN** an item is shown in a paced slot with `minDwellMs: 10000` and a fresher
  candidate becomes available after 4 seconds
- **THEN** the slot keeps showing the current item until at least 10 seconds have
  elapsed, then swaps to the fresher candidate

#### Scenario: Hold when nothing fresher

- **WHEN** the minimum dwell has elapsed but no fresher candidate is available
- **THEN** the slot SHALL keep showing the current item until a fresher candidate arrives

#### Scenario: Priority override swaps immediately

- **WHEN** a direct command (priority override) targets a paced slot while the current
  item is still within its dwell window
- **THEN** the slot SHALL swap to the commanded item immediately, ignoring the remaining
  dwell

### Requirement: Render types

The display SHALL provide two built-in render types. `text` renders an event into a DOM
lane. `graph` renders into a Cytoscape.js instance and SHALL append incrementally
(`cy.add`) for an `add` operation rather than rebuilding the whole graph, running an
animated dagre layout on update.

#### Scenario: Incremental graph append

- **WHEN** a `graph` event `{op:"add", nodes:[{id:"capture"}], edges:[{source:"mic",target:"capture"}]}`
  arrives in a graph slot that already contains node `mic`
- **THEN** the renderer appends the new node and edge to the existing Cytoscape graph
  (not a full rebuild) and runs an animated layout

#### Scenario: Text render into a lane

- **WHEN** a `text` event arrives in a text slot
- **THEN** the renderer produces a DOM element for it in that slot's lane per the slot's
  behavior (scroll or latest)

### Requirement: Visual grouping and topic reset

Graph events SHALL carry a `visual` id; deltas sharing a `visual` id append to the same
graph instance. A `graph` event with `op: "reset"` (introducing a new `visual` id) marks a
topic boundary: the current canvas visual SHALL freeze and become a prior *candidate*, and
a fresh visual SHALL begin building under the new id. A paced canvas slot therefore swaps
between distinct visuals (by id) under the director's pacing, rather than growing a single
graph without bound. This is what gives the paced director candidates to swap between.

#### Scenario: Reset starts a new visual, prior becomes a candidate

- **WHEN** a graph slot is showing visual `v1` and a `{op:"reset"}` event with `visual:"v2"`
  arrives, followed by `add` deltas tagged `visual:"v2"`
- **THEN** `v1` freezes as a prior candidate and `v2` builds up as the current visual; the
  paced director may swap between `v1` and `v2` per its dwell/freshness policy

#### Scenario: Same-visual deltas append, not reset

- **WHEN** successive `add` deltas all tagged `visual:"v1"` arrive
- **THEN** they all append to the single `v1` graph instance without starting a new visual
