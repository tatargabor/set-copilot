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
layout swapped for a differently-shaped one — by changing config, without code changes.

Swapping which layout a window uses SHALL be possible at runtime, without restarting the wall
server: a live window MAY be switched from one named layout to another mid-session, re-deriving
its grid from the new layout while keeping its box definitions unchanged. A layout switch SHALL
only re-arrange geometry; it SHALL NOT alter what any box holds or how it behaves.

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

#### Scenario: Switch a live window's layout at runtime

- **WHEN** a running window using the stacked layout is switched to the `chat-wide` layout mid-session
  (a big left column plus an equal right column), with its box assignments otherwise unchanged
- **THEN** the window SHALL re-derive its grid from the `chat-wide` layout without a server restart,
  each box keeping its behavior, pacing, and subscriptions

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
