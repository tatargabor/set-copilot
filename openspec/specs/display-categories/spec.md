# display-categories Specification

## Purpose
Define what a wall display event is and how the display knows what to do with it: a
config-declared category registry (id, label, icon, default render type), category-tagged events
routed by registry lookup alone, the payload that selects each event's renderer, and the shapes
of those payloads — text with its speaker tag, graph deltas with their optional presentation
attributes, chart, image and webpage — validated at ingest so a malformed event never reaches a
live display. The display stays agnostic to meaning: categories are data, the render-type
vocabulary is engine.
## Requirements
### Requirement: Category registry

The system SHALL resolve a registry of categories at startup, where each category has a unique
`id`, a human-readable `label`, an `icon`, and a `render` type drawn from the render-type
vocabulary: `text`, `graph`, `chart`, `image`, or `webpage`. Categories are data/config
(declarative), following the project convention that project-specific behavior lives in config,
not in `src/`. The registry SHALL be resolvable from the config layer and/or a categories module,
mirroring the existing `knowledge.adapter` seam.

A category's `render` type SHALL declare the category's *default* rendering. Where an event
carries a payload of a different supported type, the payload SHALL take precedence (see
"Payload-selected renderer"). The vocabulary itself remains closed: it is an engine fact, and
extending it is an engine change, not a config change.

#### Scenario: Resolve declarative categories

- **WHEN** the wall starts with a config defining categories `súgás` (render `text`),
  `riasztás` (render `text`), `architektúra` (render `graph`), and `metrika` (render `chart`)
- **THEN** the registry exposes all four categories, each with its `id`, `label`, `icon`, and
  `render` type available to the layout and renderers

#### Scenario: Resolve a media category

- **WHEN** a config defines a category with `render: "image"` or `render: "webpage"`
- **THEN** the registry accepts it, where previously it would have been dropped as invalid

#### Scenario: Reject invalid category definition

- **WHEN** a category is defined without an `id`, or with a `render` type outside `text`, `graph`,
  `chart`, `image`, `webpage`
- **THEN** the registry SHALL drop that category with a warning rather than crash, and the
  remaining valid categories SHALL still resolve

### Requirement: Category-tagged event schema

Every display event SHALL carry a `category` field naming the category it belongs to.
The display is agnostic to meaning: it routes and renders an event solely by looking up
its category in the registry. Text-carrying events use a `text` payload; graph-carrying
events use a `graph` payload with an operation (e.g. `add`) plus `nodes`/`edges`.

#### Scenario: Route a known category

- **WHEN** an event `{ "category": "riasztás", "text": "⚠ ellentmondás" }` arrives and
  `riasztás` is a `text` category in the registry
- **THEN** the display renders it using the text renderer in every slot subscribed to
  `riasztás`

#### Scenario: Drop an unknown category

- **WHEN** an event arrives whose `category` is not present in the registry
- **THEN** the display SHALL drop the event with a warning and continue processing
  subsequent events (no crash, no blank render)

### Requirement: Speaker attribution preserved on text events

Text events SHALL be able to carry the load-bearing `speaker` primitive
(`mic` | `system`) so the display can distinguish "én" from "mindenki más". The display
SHALL NOT invent a new capture path; it consumes the existing speaker tag.

#### Scenario: Render mic vs system distinctly

- **WHEN** a `transzkript` text event carries `speaker: "system"` and another carries
  `speaker: "mic"`
- **THEN** the display SHALL render the two with a visible distinction (e.g. label or
  styling) reflecting "én" vs "mindenki más"

### Requirement: Payload-selected renderer

An event's renderer SHALL be determined by which payload the event carries, not by the render type
of the box's subscribed category. An event SHALL carry exactly one payload; an event with none, or
with more than one, SHALL be rejected at ingest with a warning and SHALL NOT be broadcast.

This is what allows a single presentation box to hold a diagram, then a chart, then an image,
without the box or the layout being redefined.

#### Scenario: Payload determines the renderer

- **WHEN** an event `{"category":"architektúra", "chart":{...}}` arrives, where `architektúra` is
  registered with `render: "graph"`
- **THEN** the display renders it with the chart renderer, following the payload rather than the
  category default

#### Scenario: An event with two payloads is rejected

- **WHEN** an event arrives carrying both a `graph` and an `image` payload
- **THEN** ingest SHALL reject it with a warning and continue processing subsequent events

### Requirement: Media payload shapes

An `image` payload SHALL identify its source as either a local filesystem path or an absolute URL,
and MAY carry a caption. A `webpage` payload SHALL carry an absolute URL and MAY carry a title.

A local image path SHALL be resolved relative to the project root and SHALL NOT escape it; a path
resolving outside the project root SHALL be rejected at ingest. Media SHALL be validated at ingest
rather than at render time, so a malformed source never reaches a live display.

#### Scenario: A local image is served from within the project

- **WHEN** an `image` payload names a path inside the project root
- **THEN** the wall server serves that file to the client and the box renders it

#### Scenario: A path traversal attempt is rejected

- **WHEN** an `image` payload names a path that resolves outside the project root
- **THEN** ingest SHALL reject the event with a warning and the file SHALL NOT be served

#### Scenario: A malformed media source never reaches the display

- **WHEN** an `image` or `webpage` payload carries a source that is neither a valid absolute URL
  nor a resolvable in-project path
- **THEN** the event SHALL be rejected at ingest, not broadcast and then failed at render

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
