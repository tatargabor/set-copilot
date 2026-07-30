## MODIFIED Requirements

### Requirement: The inline formatting vocabulary is closed

A `text` line SHALL render a closed set of inline and block constructs: **bold**,
*italic*, `inline code`, fenced code block, bullet list, numbered list, table, and **heading**.
Anything outside that set SHALL render as literal text.

The set SHALL be closed in the same sense as the render-type vocabulary: extending it is an
engine change, never a configuration one. There SHALL be no configuration option that adds,
removes, or redefines a construct.

Heading is part of the set because the wall's largest producer of text is a mirrored Claude Code
message, and such a message is heading-structured: its sections are what make it scannable at wall
distance. Rendering `## Napirend` with its hashes was measured on the wall on 2026-07-29 (and
reported earlier while reviewing the pinned region), and the alternative — normalizing a heading to
bold before it is emitted — would put a second, invisible rendering rule in the producer path. A
heading SHALL therefore render as a heading, at a weight and size that distinguishes it from a bold
paragraph without dominating the box.

#### Scenario: A supported construct renders as structure

- **WHEN** a text line contains a markdown table
- **THEN** it SHALL render as a table — rows and columns aligned — rather than as run-on
  text or as one line per row

#### Scenario: A heading renders as a heading

- **WHEN** a text line begins a block with one or more leading `#` characters followed by a space
- **THEN** it SHALL render as a heading, with the `#` characters absent from the output

#### Scenario: An unsupported construct renders literally

- **WHEN** a text line contains markup outside the closed set (for example a link, an image
  reference, or raw HTML)
- **THEN** the characters SHALL appear as written, and SHALL NOT be interpreted

#### Scenario: The vocabulary cannot be extended by configuration

- **WHEN** a project wishes to render a construct outside the set
- **THEN** no configuration SHALL enable it; the vocabulary SHALL only change by an engine
  change
