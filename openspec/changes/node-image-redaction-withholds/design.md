# Design

## Context

`splitForZones` (`src/wall/redaction.ts`) decides an event's public variant. It first asks
`urlSourcesMatch` whether a structured source matches; that check reads only `ev.image.src` and
`ev.webpage.url`. Everything else goes through `redactValue`, the recursive string-leaf scrub,
which is where a graph node's `image` currently lands. The accumulation in `src/wall/server.ts`
already handles a `public: null` variant correctly: a withheld variant never touches the public
slice (comment and code around `server.ts:779-787`), so the replay path needs no change, only a
test that proves it for this case.

## Goals / Non-Goals

**Goals:**

- Treat a graph node's `image` as a structured source in the withhold decision.
- Keep the decision in the single funnel every producer passes through (`splitForZones`).

**Non-Goals:**

- Ingest validation of node image paths.
- A general "every key named `image`/`url`/`src` anywhere" heuristic (see Decisions).

## Decisions

- **Name the source fields, do not guess them by key name.** The redactor's content walk is
  deliberately field-list-free (D1), but the withhold rule is a statement about *which values
  are fetched as sources*, a closed set the renderer defines: `image.src`, `webpage.url`, and a
  graph node's `image` (`wall.js` hands it to the media route or loads it as a URL). Treating
  every key called `image` or `url` at any depth as a source was considered and rejected: it
  would withhold events over prose leaves that merely share a name, and it still would not be
  a guarantee, since the renderer, not the key name, decides what is fetched. If the renderer
  ever fetches a new field, that field joins this list in the same change; the spec requirement
  states the rule so a reviewer can hold a renderer change to it.
- **A node image is checked for every node of the delta, whatever its shape.** For every node
  of `graph.nodes`, every string leaf under its `image` key, at any depth, is checked as a source.
  "String values only" was the first draft and was wrong: `wall.js` hands a non-string `image`
  to Cytoscape unchanged, and Cytoscape's `background-image` is a multiple-URL property, so an
  array value loads every element as a URL (review C1). Whether the renderer fetches a given
  shape is the renderer library's business and can change, so the check does not depend on it.
  Node entries are read defensively (a `null` or non-object entry has no `image`), so a
  malformed but clean delta is not withheld through the catch-all.
- **Withhold the whole delta, not the node.** Dropping only the matching node would publish a
  graph whose structure (edges to a missing node, a group with a hole) still tells the audience
  something was there, and it would make the public slice diverge structurally from the private
  one. Whole-event withholding is also what the existing URL rule does, so there is one rule.

- **A withheld delta holds the whole visual back until its next public `reset`** (user decision
  D1, 2026-10-03). Per-delta withholding alone leaves a hole that later clean deltas build around
  (review M1). The server keeps, per visual, a "held" flag on its public side: set when a graph
  delta of that visual reaches the funnel with its public variant withheld, cleared when a `reset`
  of that visual reaches the public zone. While set, the funnel replaces the public variant of every
  further delta of that visual with "withheld" *before* accumulation and broadcast, so live clients
  and the replay agree. The public wall keeps the last state it legitimately had; it is not
  blanked, since blanking would need a synthetic public reset the producer never sent.
  *Alternative rejected:* documenting the hole as an accepted risk.

## Risks / Trade-offs

- [A held visual shows a stale topic publicly until the producer resets it] → stale, never
  leaking; the private view marks every held delta as withheld, so the operator sees why.

- [After a reload the private view marked a withheld graph delta as "redacted"] → the private
  slice records only a boolean today, so a replay cannot tell "the public saw it scrubbed" from
  "the public never saw it" (review m2). The slice keeps the more severe of the two markers,
  `withheld` over `redacted`, and the replay reports that one.

- [A pattern that matches common path segments withholds whole graphs] → that is the
  fail-closed direction this wall is built around (a redaction that withholds too much is an
  annoyance; one that leaks is the failure it exists to prevent), and the private view marks every
  withheld event, so the operator sees why a graph did not appear publicly.
- [Edges carry no source fields today] → nothing to check; if an edge ever carries a fetched
  source, the same rule applies, by the Decisions bullet above.
