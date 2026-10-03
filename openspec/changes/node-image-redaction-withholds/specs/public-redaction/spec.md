# Spec Delta

## IN SCOPE

- A redaction match in a graph node's `image` withholds the whole event from the public zone.
- A delta with several nodes is withheld whole when any one node `image` matches.
- A withheld graph delta never reaches the public replay slice.
- A node `image` of any shape: every string under it is checked as a source.
- After a withheld graph delta, the visual's later deltas stay off the public zone until a
  public-reaching `reset`.
- The producer-facing policy text names the node `image` among the withholding sources.

## OUT OF SCOPE

- Validating or confining a node `image` path at ingest; confinement stays at serve time.
- The wall transcript page and its own redaction path.
- Any change to the redaction taxonomy, the ReDoS bound, or how prose leaves are scrubbed.

## MODIFIED Requirements

### Requirement: A matching URL withholds the event, it is not scrubbed

An `image.src`, a `webpage.url`, and a graph node's `image` are structured values: a source the
wall fetches. A token inside its path or query cannot be scrubbed while leaving the source usable,
and a scrubbed source still shows everything around the match. When a redaction pattern matches any
part of such a source, the redactor SHALL withhold the **entire event** from the public zone rather
than emit a mangled source. The private zone SHALL still receive it unchanged.

For a graph event this applies to every node of the delta: if any one node's `image` matches, the
whole delta SHALL be withheld from the public zone, never published minus that node. A withheld
graph delta SHALL NOT reach the public accumulation slice, so a public client that joins later
cannot rebuild it by replay.

A graph is drawn incrementally, so withholding one delta would otherwise leave a hole that later,
clean deltas of the same visual build around (edges to the missing node, or a new topic's nodes
added onto the old topic after a withheld `reset`). Once a delta of a visual is withheld from the
public zone, every later delta of that visual SHALL also be withheld from the public zone, live and
in the public accumulation, until a `reset` of that visual reaches the public zone again. The
public wall keeps showing the last state it legitimately received; the private zone receives every
delta as usual, each marked as withheld while the visual is held back.

#### Scenario: A secret in a URL query withholds the event

- **WHEN** a `both`-zone `webpage` event has a redacted `title` but the same token appears in the
  `webpage.url` query string
- **THEN** the event is withheld from the public zone entirely (not delivered with a scrubbed title and
  a leaking URL), and the private zone receives it unchanged

#### Scenario: A clean URL passes

- **WHEN** a `both`-zone `image` event's `src` matches no redaction pattern
- **THEN** the event is delivered to the public zone

#### Scenario: A matching node image withholds the whole graph delta

- **WHEN** a `both`-zone graph event adds three nodes and only the second carries an `image` whose
  path matches a redaction pattern
- **THEN** the public zone receives no part of the delta, not even the two clean nodes, and the
  private zone receives the delta unchanged, marked as withheld

#### Scenario: A withheld node image is not replayed to a late public join

- **WHEN** a graph delta was withheld from the public zone because of a node `image`, and a public
  client connects afterwards
- **THEN** the replay that client receives contains no node from that delta, while a private client's
  replay does

#### Scenario: Later deltas of a withheld visual stay off the public wall until a reset

- **WHEN** a `both`-zone graph `reset` of visual `v2` is withheld because of a node `image`, and a
  clean `add` for `v2` follows
- **THEN** the public zone receives neither, live or by replay, the private zone receives both, and
  a later clean `reset` of `v2` reaches the public zone and lifts the hold

#### Scenario: A non-string node image is checked too

- **WHEN** a `both`-zone graph event carries a node whose `image` is an array of URLs and one
  element matches a redaction pattern
- **THEN** the event is withheld from the public zone, exactly as for a matching string `image`

#### Scenario: Clean node images pass

- **WHEN** a `both`-zone graph event's node `image` values match no redaction pattern
- **THEN** the delta is delivered to the public zone with its node images unchanged
