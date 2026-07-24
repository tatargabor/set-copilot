## MODIFIED Requirements

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

## ADDED Requirements

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
