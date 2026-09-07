## Why

The wall ships two windows — a private operator view (`én`) and a public wall (`fal`) — but
the operator's internal view is already the Claude Code session itself, the field backlog
records the operator asking for exactly the single-wall shape ("on the public I want to see
the same stream as in the private"), and only one window can ever be shared ("Meet can't
share two"). The private window also silently wastes half the producer's output: narration
is emitted `zone:"private"`, so the public wall's narration box receives nothing at all in
the shipped config. The public/private *mechanism* (zones, audience, redaction, staging)
stays untouched — it withheld real sensitive content in a live meeting and is the wall's
safety net; only the shipped default and the producer policy collapse to one surface.

## What Changes

- **BREAKING (default config only)**: `DEFAULT_WINDOWS` ships ONE window — `fal` on
  `/wall` (`audience:"public"`, layout `három-régió`, the operator's own stated target
  arrangement). The `én` operator window is removed from the default. A project config that
  still declares `wall.windows` keeps winning wholesale (existing resolution rule), so no
  migration is forced.
- `/` serves a redirect to the single declared window route (a page served at `/` would
  bootstrap-fail; the client derives its route from the pathname). A window declared at
  `/` is served, not redirected.
- Narration becomes a redaction-backed lane on the wall: the producer emits `zone:"both"`,
  the ingest-funnel redactor covers it, and the wall's single text box carries the
  public-safe mandate (summarize, never raw transcript, `[belső]` marking). The
  check-and-surface job the private hint box used to own moves to the terminal, where the
  copilot already speaks.
- Pending markers default to `zone:"both"` so the wall shows the visible "drawing…"
  placeholder the field backlog asked for — and, because pending currently bypasses the
  redaction funnel, a marker whose zone reaches a public client now passes the redactor:
  a scrubbed label if that suffices, a dropped marker when it does not (fail-closed).
- The predictive-staging mandate — which lived only in the deleted `én.staging` box's
  policy — moves into `copilot.drawing.conventions` + the skill, so staging survives the
  window it used to live in. Staged visuals stay `zone:"private"` and simply have no
  subscriber: nothing displays them until an explicit promote; `wall-staged` remains the
  way to see what is prepared.
- `riasztás` / `súgás` become chat-only (no wall box subscribes; they stay in the category
  registry). The fake feed and the skill text follow the new single-surface reality.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `live-narration`: "Narration is private by default" is retired and replaced — narration
  is a redaction-backed lane on the wall (`zone:"both"`), safe because of the ingest
  funnel, not because nobody is looking.
- `wall-pending-indicator`: "Pending markers respect the zone model" — the default zone
  becomes `both` (the visible placeholder), the zone gate itself is unchanged, and a
  public-reaching marker's label now passes the redactor fail-closed.
- `predictive-staging`: "The predictive mandate is box policy, not engine code" — the
  mandate's config home becomes the drawing contract (`copilot.drawing`), still config,
  still no engine logic. The never-publish-autonomously invariant is unchanged.
- `box-policy`: "A box's mandate is independent of its zone" — the shipped-default
  illustration is updated to the single-surface reality; the independence rule itself is
  unchanged.
- `wall-server`: new requirement — the root path reaches the wall (redirect when no window
  declares `/`).

## Impact

- `src/config.ts` (DEFAULT_WINDOWS, narration + windows preamble comments,
  DEFAULT_DRAWING_CONVENTIONS), `src/copilot-prompt.ts` (narration block, drawing
  contract, alerts note), `src/wall/emit.ts` (pending default), `src/wall/server.ts`
  (root redirect; pending scrub — the one mechanism change, closing the same hole the
  funnel already closed for events), `src/wall/feed-script.ts`, `src/wall/index.ts`
  (docstring), `skills/meeting-copilot/SKILL.md`, `docs/wall-public-parity.md`,
  `docs/wall-field-backlog.md`.
- Tests: `audience.test.ts` (shipped-window pins), `config.test.ts`, `emit.test.ts`,
  `copilot-prompt.test.ts`, new pending-redaction and root-redirect server tests.
- Engine untouched apart from the pending scrub: zones, audience resolution,
  `payloadFor` gates, per-zone accumulation, promote/expiry, `/api/staged`, the mirror
  follower, and the multi-window resolution all keep working and stay tested (existing
  server tests build two-window fixtures inline and stay green on purpose).
