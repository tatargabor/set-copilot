## Context

The shipped default (`DEFAULT_WALL` → `DEFAULT_WINDOWS`, `src/config.ts`) serves two
windows: `én` (route `/`, audience `operator`, layout `private-staging`) and `fal` (route
`/wall`, audience `public`, layout `három-régió`). The audience/zone machinery
(`resolveAudience` fail-closed, `payloadFor` gates, per-delta accumulation slices,
`publicWindowShape` policy stripping, promote/expiry, `/api/staged`) is spec'd, tested, and
field-proven — this change does not touch it. What changes is which surface ships and what
the producer is taught to emit. Field evidence and the operator's own asks are in the
proposal; the narration-zone dead spot (`fal.szöveg` subscribes `narráció`, narration is
emitted `zone:"private"`, so the box receives nothing) is the concrete bug this fixes.

## Goals / Non-Goals

**Goals:**

- One shipped window, matching how the wall is actually used (one shared tab; the terminal
  is the operator view).
- Narration, pending, and the wall's text box form one working public-safe lane.
- The staging pipeline keeps functioning end to end (draw early → expire or promote), just
  without a display surface for the un-promoted guess.
- A project that overrides `wall.windows` keeps exactly its own behavior.

**Non-Goals:**

- Removing zones / audience / redaction / staging from the engine — explicitly rejected
  (field-proven leak protection; the multi-window mechanism stays and stays tested).
- Merging the two text-box mandates into a new mechanism; the surviving box keeps the
  public-safe mandate and the check-and-surface job moves to the terminal.
- Any change to layout geometry (`három-régió` already matches the operator's target);
  `private-staging` stays in `DEFAULT_LAYOUTS` for projects that want it.
- A doctor/init report for projects still declaring two windows (backlog #8 territory).

## Decisions

**1. Config-level collapse, engine intact.** Alternative: delete the audience/zone/redaction
machinery (~1000 lines) — rejected: it withheld salaries and a named-client PDF under live
stress, its invariants are documented and unit-tested by name, and a future second surface
(a projector mode, an OBS overlay) would need it rebuilt. The wall's safety posture
degrades gracefully: with one `public`-audience window, redaction applies to everything
shown.

**2. The narration lane rides `zone:"both"` and leans on the ingest funnel.**
Alternative: a new "wall" zone, or per-box zone overrides — new mechanism for what the
existing gate already does. The producer text keeps the safety rule where it belongs: mark
`[belső]` or drop, never raw transcript; the redactor is the enforcement, the wording is
the instruction. Cadence/verbosity wording is kept byte-identical so the measured "more
talkative" posture the operator asked for survives the rewrite.

**3. Pending flips to visible BY closing its redaction hole first.** Pending markers
short-circuit the ingest funnel before `splitForZones` and broadcast the label verbatim —
fine while the default was `private` (nobody but the operator saw it), a leak the moment
the default reaches a public client. So the flip ships together with: reach-public marker →
`scrub(label)`; still matching after scrub, or scrub throws → drop the marker (the same
fail-closed posture as `splitForZones`). Private-only markers keep the raw label. This is
the one mechanism change in the change, and it is the funnel's existing guarantee extended
to the last payload type that bypassed it.

**4. The staging mandate relocates to `copilot.drawing.conventions`.** It lived only in the
`én.staging` box's policy; deleting the window would delete the mandate from the rendered
prompt and predictive staging would quietly die with no error anywhere. The drawing
contract is the producer-facing seam for exactly this (and already teaches promote). The
requirement "box policy, not engine code" keeps its meaning: the mandate is still config
data rendered into the prompt, now under the drawing contract's key instead of a box's.

**5. `/` redirects (302) to the single declared route.** Serving the page at `/` would
bootstrap-fail — the client derives its route from `location.pathname`, and no window
would match. A redirect also keeps the operator's muscle memory and any bookmarks working.
A project window declared at `/` is served normally (no redirect when a window claims the
path).

**6. Alerts go chat-only, deliberately invisible on the wall.** `riasztás`/`súgás` keep
their category registry entries (registry ≠ routing) and the emit ordering is untouched —
only the wall boxes stop subscribing, and the policy says they are chat-only. Alternative:
subscribe the wall's text box to them with heavy redaction — rejected: the terminal already
carries them, and the wall is by definition the surface that may have an audience.

## Risks / Trade-offs

- [The staging expiry marker is private-only, so with no operator view an expired guess is
  invisible] → documented in the skill: do not wait to *see* a guess expire; `wall-staged`
  answers what is still prepared. The expiry itself is unchanged server-side.
- [A stale project config still declaring two windows silently keeps its own private view]
  → that is the existing wholesale-override rule (backlog #8, open); noted in the docs
  rather than "fixed" here.
- [Pending labels are producer text on a public wall] → bounded by the scrub + fail-closed
  drop, and the policy requires captions to be short, mechanical, content-free.
- [The fake feed's private beats would render nothing on the single wall] → rezoned to
  `both`, plus one pending beat so the placeholder path stays demoed.

## Migration Plan

None forced: `wall.windows` overrides wholesale (existing rule), so a project that wants
its private view back declares it. Default-config deployments get the single wall on the
next start. Rollback = revert the commits.

## Open Questions

None.
