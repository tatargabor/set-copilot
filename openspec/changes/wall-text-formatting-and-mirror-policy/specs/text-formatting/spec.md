## ADDED Requirements

### Requirement: The inline formatting vocabulary is closed

A `text` line SHALL render a closed set of inline and block constructs: **bold**,
*italic*, `inline code`, fenced code block, bullet list, numbered list, and table.
Anything outside that set SHALL render as literal text.

The set SHALL be closed in the same sense as the render-type vocabulary: extending it is an
engine change, never a configuration one. There SHALL be no configuration option that adds,
removes, or redefines a construct.

#### Scenario: A supported construct renders as structure

- **WHEN** a text line contains a markdown table
- **THEN** it SHALL render as a table — rows and columns aligned — rather than as run-on
  text or as one line per row

#### Scenario: An unsupported construct renders literally

- **WHEN** a text line contains markup outside the closed set (for example a link, an image
  reference, or raw HTML)
- **THEN** the characters SHALL appear as written, and SHALL NOT be interpreted

#### Scenario: The vocabulary cannot be extended by configuration

- **WHEN** a project wishes to render a construct outside the set
- **THEN** no configuration SHALL enable it; the vocabulary SHALL only change by an engine
  change

### Requirement: Formatted content is constructed as elements, never as markup

Formatted output SHALL be built by constructing elements and assigning their text content.
Event-derived content SHALL NOT be assigned as markup, string-interpolated into markup, or
otherwise parsed as HTML at any point in the pipeline.

This invariant SHALL hold independently of what the formatter recognizes: an input the
formatter does not understand SHALL degrade to literal text, never to interpreted markup.

#### Scenario: Markup in the payload is inert

- **WHEN** a text payload contains a fragment that would be meaningful as HTML
- **THEN** it SHALL be displayed as literal characters, and SHALL NOT become part of the
  document structure

#### Scenario: A malformed construct degrades to text

- **WHEN** a construct is opened but never closed (for example an unterminated code fence
  or a truncated table)
- **THEN** the affected region SHALL render as literal text and the rest of the line SHALL
  still render, with no error state on the wall

### Requirement: The payload stays a plain string

Formatting SHALL be derived from the existing `text` payload at render time. The event
schema SHALL NOT gain a formatting payload, a markup field, or a per-event formatting flag.

This keeps every existing producer, the server-side redaction funnel, and the accumulated
state replayed to a reconnecting client unchanged: they continue to see and operate on one
string.

#### Scenario: Existing producers are unaffected

- **WHEN** a producer that predates this capability emits a plain text event
- **THEN** it SHALL render exactly as before, with no producer change required

#### Scenario: Redaction still operates on the string

- **WHEN** a formatted line is destined for the public zone
- **THEN** redaction SHALL apply to the payload string as it does to any other text event,
  before formatting is derived — formatting SHALL NOT create a path around the funnel

### Requirement: Formatted output is compact enough to read at wall distance

Formatting SHALL favor density: a construct SHALL occupy the space its structure needs and
no more, so that a table or list read from across a room is not expanded into one screen
line per element. The reference target SHALL be a 1920×1080 display, not the largest
monitor available.

#### Scenario: A list is not expanded into separate wall lines

- **WHEN** a text line contains a bullet list of several items
- **THEN** it SHALL render as one list within one wall line, not as several independent
  wall lines competing with the surrounding stream

#### Scenario: Oversized content stays inside its box

- **WHEN** a formatted construct is wider than its box (for example a wide table)
- **THEN** it SHALL remain contained — the box SHALL NOT force the wall layout to change
  size or the page to scroll sideways
