## Why

The operator wants the public wall to be able to carry what the private view carries, and
says plainly that the current split is an assumption rather than a requirement
(`docs/wall-field-backlog.md` §B2): *"jelenleg a public az egy általad elképzelt
lehatárolás, de valójában simán lehet, hogy én a publicon ugyanezt a folyamatot akarom
látni, mint a private-ben"* — plus the inverse case, where the only wall on screen is the
public one and the private view is his own Claude Code session.

Most of that is already expressible: boxes, categories, and policies are config, so a
window can subscribe to whatever it likes. But the obvious way to do it is a trap, and it
is a leak.

A window's audience is inferred, today, from the inverse of its zone list:
`isPublicClient(client)` is `!client.zones.includes("private")`
(`src/wall/server.ts:643-645`). Redaction, the private/public accumulation split, the
`stage-expired` marker, and the zoned `show` all key off that one predicate. So an operator
who wants the public wall to show more, and does the natural thing — adds `"private"` to
the public window's `zones` — does not get "a public wall with more content". They get a
window the server no longer considers public **at all**: redaction stops running for it,
the private accumulation slice is replayed to it, and it is displayed to a live audience.
One config edit, no warning, and the project's highest-stakes safety property is off.

This is the same class of defect as §A1–A2 in the same backlog: a safety-relevant
precondition that fails silently. Here it fails *toward disclosure*, which makes it the
more urgent of the two.

## What Changes

- **A window declares its audience explicitly**, separately from which zones it shows.
  Redaction, the accumulation slice, the zoned `show`, and the private-only markers key off
  that declaration instead of inferring it from the zone list.
- **The inference fails closed.** A window that does not declare an audience, or declares
  one that cannot be understood, is treated as public — the direction that redacts more,
  never less. Today's inference is the opposite: an unrecognized zone list silently yields
  "private, no redaction".
- **A public surface never receives private-zone events**, and that becomes an explicit,
  enforced rule rather than an emergent consequence of the zone filter. `zone: "private"`
  stays the only reliable way to keep something off a public wall — so the way to show more
  publicly is to emit it as `both`, through redaction, not to widen a window's zones.
- **Parity is a supported shape, not a hand-rolled one.** The shipped configuration gains a
  documented way to give the public wall the same box set the private view has, so an
  operator asking for §B2 lands on the safe path instead of inventing the unsafe one.
- Non-goals: no change to the redaction mechanism (the recursive walk, URL withholding,
  ReDoS bound, per-delta replay zoning, fail-closed handling), no change to the pattern
  taxonomy, no new zone, and no relaxation of what private means.

## Capabilities

### Modified Capabilities
- `public-redaction`: whether a client is a public surface SHALL be an explicit declaration
  that fails closed, not an inference from its zone list; and a public surface SHALL NOT
  receive private-zone events regardless of how its zones are configured.

## Impact

- `src/wall/types.ts` — the window's audience declaration.
- `src/config.ts` — the field, its default, and the shipped windows; a warning when a
  window's zones and audience disagree in a way that used to silently disable redaction.
- `src/wall/server.ts` — `isPublicClient` becomes a read of the declaration
  (`:643-645`), with every consumer of it unchanged in behavior for existing configs.
- `src/wall/layout.ts` / resolution — carry the declaration onto the resolved window.
- Tests: the audience resolution and its fail-closed default are pure and unit-tested,
  including the "old config with `private` in a public window's zones" case.
- Docs: CLAUDE.md's wall section states the zone rule; it gains the audience distinction.
