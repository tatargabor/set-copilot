# Spec Delta

## ADDED Requirements

### Requirement: Graph nodes and edges carry optional presentation attributes

A `graph` payload's nodes and edges SHALL accept the following optional attributes, each
changing only how the visual is drawn:

- node `tone`: one of `primary`, `secondary`, `shared`, `open`, `done` — a colour role (for
  example which side builds a work package) drawn from the wall theme's palette, so a producer
  never names a colour. `open` SHALL be drawn with a dashed border. Any other value is drawn as
  an ordinary node.
- node `parent`: the id of another node; the node SHALL be drawn inside that node, which is
  drawn as a labelled group box.
- edge `invisible: true`: the edge SHALL take part in the layout but SHALL NOT be drawn — it
  shapes the arrangement (for example stacks a group's members into a column) without a line.
- node `x` and `y` (both numbers): an exact position (see `display-layout`, "Render types").
- node `image` (with optional `w`/`h` for its size): the node SHALL be drawn as that picture
  instead of a labelled box. An `http(s)` URL SHALL be loaded directly; any other value SHALL
  be requested through the wall's media route, which serves only image files inside the project
  root. Unlike an `image` event's `src`, a node `image` is NOT validated at ingest: confinement
  happens when it is served, and a source outside the project simply does not load.
  A node `image` is an ordinary string leaf of the graph payload, so the public-zone redactor
  scrubs a match in it like any other leaf; the whole-event withholding that applies to an
  `image.src` or `webpage.url` does not extend to it.

Edges MAY carry a `label`, drawn on the edge. Because the graph payload is open, none of these
attributes is required, and an event without them SHALL render as before.

#### Scenario: A toned work package

- **WHEN** a graph event carries a node `{ "id": "wp1", "label": "Data model", "tone": "secondary" }`
- **THEN** the node is drawn in the theme's secondary colour role

#### Scenario: A group with a layout-only edge

- **WHEN** nodes `a` and `b` carry `parent: "g"`, node `g` exists, and an edge `a → b` carries
  `invisible: true`
- **THEN** `a` and `b` are drawn inside a group box labelled with `g`'s label, arranged by the
  edge, and no line is drawn between them

#### Scenario: A figure from a project document as a node

- **WHEN** a node carries `image: "docs/figures/flow.png"`, `w: 400`, `h: 240`
- **THEN** the node is drawn as that picture at 400×240, fetched through the media route, and the
  visual gets the canvas tabs, follow and full screen of any graph

#### Scenario: A node image outside the project does not load

- **WHEN** a node carries `image: "../outside/secret.png"`
- **THEN** the event is accepted, the media route refuses the file, and nothing outside the
  project is served

### Requirement: An event may name its visual with a short title

A display event SHALL accept an optional `title`: a non-blank string, trimmed and cut to 80
characters at ingest (trimmed first, then cut); a blank or non-string title SHALL be ignored. The title is the visual's
human name — the canvas tab label (`wall-presentation`) — and SHALL be kept per zone with the
visual's accumulated state so it is replayed on reconnect. It is producer text like any other
string leaf: the public variant of an event SHALL carry the scrubbed title, and the public
accumulation SHALL store only the scrubbed copy.

#### Scenario: A long title is cut

- **WHEN** an event carries a 120-character `title`
- **THEN** the ingested event's `title` is the first 80 characters of the trimmed title

#### Scenario: A sensitive title is scrubbed for the public wall

- **WHEN** a `both`-zone graph event's `title` contains a redaction-matching token
- **THEN** the public client receives, and later replays, the scrubbed title, while the private
  view keeps the original
