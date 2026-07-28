## Context

`isPublicClient(client)` is one line — `!client.zones.includes("private")`
(`src/wall/server.ts:643-645`) — and it is the pivot for everything the public zone is
protected by: which redacted variant `broadcastEvent` writes (`:648-658`), which
accumulation slice `replay` reads (`:714`, `:722`, `:732`), whether a `stage-expired`
marker is suppressed (`:436`), and the zoned `show`. It conflates two genuinely different
questions — *what may this window display?* and *is a live audience looking at it?* — and
it answers the second by negating the first.

That conflation is invisible while the shipped windows happen to line up (`én` has
`private`, `fal` does not). It becomes a leak the moment an operator changes a zone list to
show more, which is exactly what §B2 asks for.

The redaction spec is already explicit that redaction is *"a shape-matcher, not a security
boundary: `zone: \"private\"` remains the only reliable way to keep something off the public
wall."* This change makes the code match that sentence: the reliable gate must not be
reachable through a field whose purpose reads as "what to display".

## Goals / Non-Goals

**Goals:**
- Make a window's audience an explicit, fail-closed declaration.
- Make "show more on the public wall" reachable without touching anything safety-relevant.
- Keep every existing config resolving to the same *protection* it has today (behavior may
  become strictly more protected, never less).

**Non-Goals:**
- No change to the redaction mechanism or taxonomy.
- No new zone value. Three zones stay three zones.
- Not a way to put private content on a public wall. The opposite: this closes the way that
  exists.
- No change to what the private view shows.

## Decisions

### D1 — `audience: "public" | "operator"` on the window, defaulting to `"public"`

The declaration is a window property alongside `zones`, resolved onto `ResolvedWindow` and
carried to the `Client`. `isPublicClient` becomes a read of it.

Naming: `audience` rather than `public: boolean`, because a boolean invites `public: false`
being read as "off" (a permission being disabled) rather than as "this surface has a
different audience". And `"operator"` rather than `"private"` for the non-public value, so
it does not read as a fourth zone and get confused with `zone: "private"` — the two are
different axes and sharing a word between them is how this defect started.

Default `"public"`: an unspecified audience is the protected reading. This inverts today's
behavior, where an unrecognized zone list yields "not public → no redaction".

*Alternative rejected:* keep inferring, but from a longer expression (e.g. "public unless
zones contain private AND the route is not /wall"). More rules for the same conflation; the
defect is the inference itself.

### D2 — Migration is by explicit default on the shipped windows plus a warning, never a silent reinterpretation

The two shipped windows declare their audience explicitly (`én` → `operator`, `fal` →
`public`), so nothing changes for a default install. A project config that predates the
field gets the fail-closed default — meaning a custom "private" window that never declared
an audience becomes **more** redacted than before.

That is a deliberate, one-directional trade: a wall that redacts content it did not need to
is a cosmetic annoyance; a wall that failed to redact is the thing this change exists to
prevent. The warning names the window and the fix, so the operator can add one field and
get their private view back. This posture matches the redaction capability's existing
fail-closed rule — withhold on doubt — rather than the wall's usual "drop it with a warning
and carry on".

### D3 — The private-zone gate for a public surface is enforced at broadcast, not left to the zone filter

Requiring "a public surface never receives private events" could be left implicit: an
operator simply should not put `private` in a public window's zones. That is what we have
now, and it is what breaks.

Instead the check is explicit and lives with the other gate in `broadcastEvent`: if the
client is a public surface and the event's zone is `private`, it does not go out —
regardless of the zone filter. The zone filter keeps its meaning for everything else. A
config that trips this warns once at resolution, rather than silently per event.

Note what this does *not* do: it does not let private content reach a public wall in
redacted form. Redaction is a shape-matcher; the spec says so, and a classifier is not what
stands between an internal detail and a live audience.

### D4 — Parity is delivered as configuration, not as a mechanism

Everything §B2 actually needs — the public wall carrying the mirror, the narration, and a
pinned box; or a single public window with no private window at all — is already
expressible once D1 removes the trap. So the deliverable is a documented shipped shape plus
the box policies that make it sensible, not new engine capability.

The distinction worth writing down for the operator: parity means *the same boxes*, not
*the same feed*. A public wall showing the mirror box shows the mirrored chat that was
emitted to a shared zone and survived redaction — which is what he is actually asking to
see — not the operator's private hint stream.

## Risks / Trade-offs

- **A project's custom private window silently starts redacting** (D2). → Warned at
  resolution with the window named and the one-field fix; and the direction of the change
  is toward protection, which is the acceptable direction to be wrong in.
- **`audience` and `zones` are two fields that can disagree**, which is a new way to be
  confused. → The disagreement is warned about, and resolution is defined (protected
  reading wins). Two honest axes beat one axis silently doing two jobs.
- **Someone later re-derives `isPublicClient` from zones** for convenience. → The predicate
  becomes a single accessor with a comment naming this change and the leak; and the
  fail-closed default is unit-tested, so re-inferring would break a named test.
- **Operators read `audience: "operator"` as "nobody can see it"**. → It is a display
  audience, not an access control. The doc line says so, and `zone: "private"` remains the
  content-side gate.

## Migration Plan

The shipped windows gain an explicit `audience` (D2), so a default install is unchanged. A
project config with a custom window is resolved fail-closed and warned. There is no data
migration, no runtime artifact change, and no producer-visible change: producers still emit
zones, not audiences.

Rollback is a revert; the field is additive and an older build ignores it (with, notably,
the old inference — which is why this should not ship half-applied across a shared runtime
dir).

## Open Questions

- Should `doctor` report each window's resolved audience? It is cheap and it fits the
  diagnostics change landing alongside this one — decide when both are applied.
- Whether the private view should visibly mark that a box is *also* on a public surface.
  There is already a redaction badge for "what the public did not get"; the inverse marker
  may be redundant. Deferred.
