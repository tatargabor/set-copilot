## MODIFIED Requirements

### Requirement: Track sizes may be overridden at view time without altering the layout

A viewer SHALL be able to adjust the proportions between a window's regions by dragging the
boundaries between them, and the adjustment SHALL persist for that viewer across reloads
and reconnects.

The adjustment SHALL be a **viewport override**: it changes only the track sizes the window
is rendered with. It SHALL NOT modify the layout definition, SHALL NOT change which
positions exist or where they sit relative to one another, and SHALL NOT alter any box's
behavior, pacing, subscriptions, or policy. The three-layer separation — layout is
geometry, box is content, position binds them — SHALL survive the override intact.

A drag SHALL act on the dragged boundary only: redistributing size between the two tracks
that meet at that boundary. Tracks that the drag does not reach SHALL keep their rendered
proportions, and a track whose size the layout declares as content-driven (`auto`) SHALL
keep that declaration until its own boundary is dragged. Each track SHALL remain at or
above the minimum share of its axis; when the dragged pair saturates at that floor, the
drag stops rather than displacing other boundaries.

A viewer SHALL be able to discard the override and return to the layout's declared
proportions.

The separator control SHALL straddle the boundary it operates: its visible bar SHALL be
centered on the gap between the two regions it resizes, on both axes. The separator SHALL
win pointer interaction over box-internal overlays at their crossing, so what looks like
the boundary resizes the boundary.

A drag SHALL write geometry only for the layout it started against: if the window's layout
changes while a drag is in progress, the gesture SHALL be discarded and no override SHALL
be written for it.

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

#### Scenario: Dragging one boundary leaves the others alone

- **WHEN** a viewer drags one boundary on an axis that has more than one boundary, or
  drags with a neighbouring track already at the minimum share
- **THEN** only the two tracks meeting at the dragged boundary SHALL change size; every
  other boundary SHALL stay where it was, and the drag SHALL stop at the floor instead of
  pushing it to another boundary

#### Scenario: A content-driven track keeps its declaration until dragged

- **WHEN** a layout declares a track `auto` and the viewer drags a different boundary on
  that axis
- **THEN** the `auto` track SHALL still be sized by its content — the override SHALL
  replace only the pair at the dragged boundary

#### Scenario: The separator reads as the boundary

- **WHEN** a window renders its splitter controls
- **THEN** each visible separator bar SHALL be centered on the gap between the two regions
  it resizes, on both the horizontal and the vertical axis, and clicking the bar SHALL
  start a resize rather than activating an overlay inside either region

#### Scenario: A layout switch mid-drag discards the gesture

- **WHEN** the window's layout changes between pointer-down and pointer-up of a drag
- **THEN** the drag SHALL end without writing an override, and the window SHALL render the
  new layout's declared proportions
