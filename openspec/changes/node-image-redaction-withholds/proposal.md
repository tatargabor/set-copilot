# Proposal

## Why

A graph node's `image` is a structured source, a URL or a project path the wall fetches, exactly
like an `image` event's `src` or a `webpage`'s `url`. A redaction match in those two withholds the
whole event from the public wall, because a source cannot be scrubbed while staying meaningful. A
node `image` is instead scrubbed like prose. The public wall then receives a broken path that
still shows everything around the match (the directory, the rest of the file name), plus a node
that silently fails to load. Found during the 2026-10-03 spec resync and recorded there as
current behaviour; on a public wall this is a leak path, so it is fixed first.

## What Changes

- A redaction match inside any graph node's `image` SHALL withhold the whole event from the
  public zone, exactly as a match in `image.src` or `webpage.url` does. The private zone still
  receives the event unchanged, marked as withheld.
- One matching node is enough: a delta with several nodes is withheld whole, never published
  minus the matching node.
- A withheld graph delta never reaches the public replay slice, so a public client that joins
  later cannot rebuild it. The engine already behaves this way for every withheld variant; the
  change pins it with a test.
- The `display-categories` text that records the old scrub-a-node-image behaviour is corrected.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `public-redaction`: the URL-withholding requirement extends to a graph node's `image`.
- `display-categories`: the node-attribute requirement stops stating that a node `image` is
  scrubbed like any other leaf.

## Impact

- `src/wall/redaction.ts`: the structured-source check that decides withholding.
- Tests: `src/wall/redaction.test.ts`, `src/wall/server.redaction.test.ts`.
- No config, CLI, or wire-format change. A producer whose node images match no pattern sees no
  difference; one whose node image matches now sees the event on the private view only (marked
  withheld), where before the public wall drew a broken picture.
- Review: this change touches the public-wall redaction path, so it goes through `/opsx:review`.
