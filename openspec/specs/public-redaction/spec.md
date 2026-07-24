# public-redaction Specification

## Purpose
Automatically redact or withhold internal content on its way to the public wall zone,
so a `both`/`public` event a producer draws cannot leak internal data to a live audience.
The redaction *mechanism* — recursive payload walk, URL withholding, per-delta replay zoning,
zoned `show`, fail-closed handling, and a ReDoS bound — is engine; the *taxonomy* (patterns and
the marking convention) is config behind `wall.redaction`. It is a shape-matcher, not a security
boundary: `zone: "private"` remains the only reliable way to keep something off the public wall.

## Requirements

### Requirement: Redaction walks the whole payload, not a field list

The public-zone redactor SHALL apply its patterns to every string leaf of an event's payload tree, at
arbitrary depth and under arbitrary keys, not to an enumerated set of fields. The `DisplayEvent`
payload is open — `GraphNode` and `ChartDatum` carry `[k: string]: unknown` — so any redactor keyed on
a fixed field list SHALL be considered incorrect, because the list can never be complete.

Each of the following was reproduced against the field-list redactor that was removed from
`wall-layout-and-box-policy`; each SHALL be closed here.

#### Scenario: A free-form payload key is redacted

- **WHEN** a `both`-zone graph event carries `nodes[].secretNote` containing a redaction-matching
  token, a key the field-list redactor never enumerated
- **THEN** the token does not appear in the event delivered to a public client

#### Scenario: A structural identifier is redacted

- **WHEN** a `both`-zone graph event carries a `node.id` or a `chart.unit` / `chart.data[].note`
  containing a redaction-matching token
- **THEN** none of those values reach a public client with the token intact

#### Scenario: Nesting depth does not defeat redaction

- **WHEN** a redaction-matching token is nested several objects/arrays deep in the payload
- **THEN** it is still redacted before the event reaches a public client

### Requirement: A matching URL withholds the event, it is not scrubbed

An `image.src` or `webpage.url` is a structured value: a token inside its path or query cannot be
scrubbed while leaving the URL usable. When a redaction pattern matches any part of such a source, the
redactor SHALL withhold the **entire event** from the public zone rather than emit a mangled URL. The
private zone SHALL still receive it unchanged.

#### Scenario: A secret in a URL query withholds the event

- **WHEN** a `both`-zone `webpage` event has a redacted `title` but the same token appears in the
  `webpage.url` query string
- **THEN** the event is withheld from the public zone entirely (not delivered with a scrubbed title and
  a leaking URL), and the private zone receives it unchanged

#### Scenario: A clean URL passes

- **WHEN** a `both`-zone `image` event's `src` matches no redaction pattern
- **THEN** the event is delivered to the public zone

### Requirement: Replay filters by per-delta zone

The server's accumulated graph SHALL store zone at the **delta** level, not once per visual. Replay to
a newly connected client SHALL filter each accumulated delta by its own zone. Overwriting a visual's
zone with the zone of its latest delta is prohibited, because it laundered private history into a later
public join.

#### Scenario: A public join does not receive private graph history

- **WHEN** two `private` graph deltas are followed by one `both` delta on the same visual, and then a
  public client connects
- **THEN** the public client receives only the `both` (and any `public`) deltas, never the two
  `private` ones

### Requirement: The show command is zoned

A canvas-swap (`show`) command carries a `visual` id that is free producer text. The `show` SHALL be
delivered only to clients whose zone matches the referenced visual's zone. An unzoned `show` broadcast
is prohibited, because a private visual's id is itself potentially sensitive.

#### Scenario: A private visual's show does not reach a public client

- **WHEN** a `private` visual named `[internal] project-hush` is shown
- **THEN** no public client receives that `show`, and the id string does not appear on the public wall

### Requirement: Pattern evaluation is bounded against catastrophic backtracking

Redaction patterns come from config and run on the server's single thread. Their evaluation SHALL be
bounded so that a single event cannot stall every connected wall — via a per-evaluation time budget,
static rejection of catastrophic-backtracking constructs at config-load time, or an equivalent guard.

#### Scenario: A pathological pattern does not stall the wall

- **WHEN** a config pattern such as `(a+)+$` is evaluated against a crafted input
- **THEN** evaluation is bounded and the wall keeps serving other events, rather than blocking for
  seconds on one

### Requirement: Redaction fails closed

If redaction cannot complete for any reason — pattern compile failure, evaluation timeout, an
unexpected payload shape — the event SHALL NOT be delivered to the public zone. This deliberately
departs from the project's usual "drop the bad input and carry on" rule: here, carrying on *is* the
leak. An invalid config pattern SHALL be dropped at load time with a conspicuous warning rather than
killing capture.

#### Scenario: A redaction failure withholds the event from the public zone

- **WHEN** redaction of a `both`-zone event throws or times out
- **THEN** the event is not delivered to the public zone; the private zone may still receive it

#### Scenario: An invalid config pattern warns, it does not crash

- **WHEN** `wall.redaction` contains a malformed pattern
- **THEN** that pattern is dropped with a conspicuous warning and capture continues with the remaining
  patterns

### Requirement: Redaction is observable on every payload type

When a value is redacted or an event withheld, the private view SHALL carry a marker regardless of
payload type — a redacted graph label, chart title, or image caption SHALL be as visible to the
operator as a redacted text line. The operator must be able to see what the audience did not.

#### Scenario: A redacted graph label is marked in the private view

- **WHEN** a graph node's label is redacted before the event goes public
- **THEN** the private view shows a marker on that event, not a silently-diverging pair of renders

### Requirement: The redaction taxonomy is config, never code

The redaction *mechanism* (recursive walk, URL withholding, fail-closed, replay zoning) is engine and
lives in `src/`. The redaction *taxonomy* — the patterns, the marking convention (e.g. `[belső]`), the
name/term lists that decide what is sensitive — is project-specific and SHALL live behind the config
seam (`wall.redaction`), never as a regex in `src/`. This is the same rule the engine already applies
to `copilot.alerts`, `detect.urgency`/`detect.question`, and `knowledge.keywords`: the package was
extracted from one project, and a default that encodes that project's names or vocabulary would leak it
back into every other project that runs the wall.

The shipped defaults SHALL therefore be domain-neutral: a conservative, marker-driven default (an
operator flags with a convention) rather than a baked-in list of one project's sensitive terms. Any
richer default (generic name/PII detection) SHALL be opt-in config, so a different project is never
silently redacting — or failing to redact — against another project's assumptions.

#### Scenario: Adding a project's sensitive terms requires no engine edit

- **WHEN** a project needs to redact its own internal names and terms
- **THEN** it declares them in `wall.redaction` config, and neither `src/` nor a skill is edited

#### Scenario: The default carries no project-specific vocabulary

- **WHEN** the package runs in a fresh project with no `wall.redaction` config
- **THEN** the shipped default matches only its documented marking convention, not any prior project's
  names or terminology

### Requirement: Redaction runs in the shared ingest funnel, before broadcast

Redaction SHALL run inside the shared `ingest` path, on the same funnel every producer's events pass
through (including the JSONL tailer), before any broadcast or accumulation. A redaction that only runs
in the `wall-emit` CLI is prohibited, because the tailer would bypass it — the same bypass class that
`wall-layout-and-box-policy` closed for schema validation.

#### Scenario: A tailer-ingested event is redacted

- **WHEN** a `both`-zone event enters via the JSONL tailer rather than the `wall-emit` CLI
- **THEN** it is redacted on the same terms as a CLI-emitted event before reaching any public client
