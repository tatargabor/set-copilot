## ADDED Requirements

### Requirement: Category registry

The system SHALL resolve a registry of categories at startup, where each category has
a unique `id`, a human-readable `label`, an `icon`, and a `render` type of exactly
`text` or `graph`. Categories are data/config (declarative), following the project
convention that project-specific behavior lives in config, not in `src/`. The registry
SHALL be resolvable from the config layer and/or a categories module, mirroring the
existing `knowledge.adapter` seam.

#### Scenario: Resolve declarative categories

- **WHEN** the wall starts with a config defining categories `transzkript` (render `text`),
  `súgás` (render `text`), `riasztás` (render `text`), and `architektúra` (render `graph`)
- **THEN** the registry exposes all four categories, each with its `id`, `label`, `icon`,
  and `render` type available to the layout and renderers

#### Scenario: Reject invalid category definition

- **WHEN** a category is defined without an `id`, or with a `render` type other than
  `text` or `graph`
- **THEN** the registry SHALL drop that category with a warning rather than crash, and
  the remaining valid categories SHALL still resolve

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
