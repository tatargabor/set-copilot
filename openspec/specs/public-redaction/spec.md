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

### Requirement: A window's audience is declared, not inferred, and defaults to public

Whether a display surface is public SHALL be an explicit property of the window, and every
public-zone protection — redaction, the zone-appropriate accumulation slice used for
replay, the zoning of `show` commands, and private-only markers — SHALL key off that
property.

The resolution SHALL fail closed: a window that declares no audience, or an audience that
cannot be understood, SHALL be treated as **public**. Widening what a window displays SHALL
NOT be able to disable its public-zone protections as a side effect.

Where a window's declared audience and its zone filter disagree in a way that would
previously have disabled protection, resolution SHALL warn, and SHALL resolve toward the
protected reading.

#### Scenario: An unreadable audience resolves to public

- **WHEN** a window is resolved whose audience declaration is missing or malformed
- **THEN** it SHALL be treated as a public surface, with redaction and every other
  public-zone protection in force

#### Scenario: Widening a window's zones does not disable redaction

- **WHEN** a window declared as a public surface has its zone filter widened
- **THEN** redaction SHALL continue to apply to everything that reaches it, and the window
  SHALL NOT be reclassified as private as a consequence of its zone list

#### Scenario: A disagreement is reported

- **WHEN** a window's zone filter and its declared audience disagree
- **THEN** resolution SHALL warn, naming the window, and SHALL apply the protected reading
  rather than the permissive one

### Requirement: A public surface never receives private-zone events

A window resolved as a public surface SHALL NOT receive events zoned `private`, under any
zone-filter configuration. `zone: "private"` SHALL remain the only reliable way to keep
content off a public wall, and no configuration SHALL be able to route a private event onto
a public surface — not even through redaction, which is a shape-matcher and not a
classifier.

Making content publicly visible SHALL therefore be done by emitting it to a shared zone, so
that it passes through redaction, and never by widening a public surface's zone filter.

#### Scenario: A private event cannot be configured onto a public wall

- **WHEN** a window resolved as a public surface has `private` in its zone filter and a
  private-zone event is broadcast
- **THEN** the event SHALL NOT reach that window's clients

#### Scenario: Shared-zone content reaches a public surface through redaction

- **WHEN** an event intended for the audience is emitted to a shared zone
- **THEN** it SHALL reach the public surface, having passed through redaction exactly as
  any other public-zone event

#### Scenario: Parity does not mean a private feed

- **WHEN** a public wall is configured to carry the same box set as the private view
- **THEN** those boxes SHALL show only the shared- and public-zone events for their
  categories — the same boxes, not the same feed

### Requirement: The transcript page is a public surface redacted by the same taxonomy

The live transcript page (`wall-transcript-page`) SHALL be treated as a public surface: every line
it serves SHALL be run through the wall's redaction taxonomy (`wall.redaction`) before it leaves
the server, unless the page is explicitly configured with `wall.transcriptPage.redact: false`.
Only that explicit `false` SHALL turn redaction off; an absent, malformed or any other value
SHALL keep it on.

The page SHALL fail closed: when redaction of a line throws — a leaf longer than the redaction
input cap, a pattern error — or when a pattern still matches the scrubbed text, the line's text
SHALL be replaced in full by the configured replacement marker rather than served. The line's
speaker and time MAY still be shown, so the reader sees that something was said and withheld.

This surface is NOT part of the shared ingest funnel and NOT part of the window audience model:
transcript lines are read straight from the capture's file per request, never ingested as display
events, and the page has no `audience` declaration. Its protection is exactly the `redact`
setting; a window's `audience` or `zones` do not affect it.

#### Scenario: A marked term is scrubbed on the transcript page

- **WHEN** the redaction taxonomy matches `40 man-days` and a transcript line reads
  `that is 40 man-days`
- **THEN** the page receives `that is [internal]` (the configured replacement), not the original

#### Scenario: Redaction off is an explicit decision

- **WHEN** `wall.transcriptPage.redact` is `false`
- **THEN** the page receives the line unredacted; with the key absent or set to any other value,
  it receives the redacted line

#### Scenario: An over-long line is withheld, not passed through

- **WHEN** a transcript line is longer than the redaction input cap
- **THEN** its text is served as the replacement marker alone, with none of the original text
