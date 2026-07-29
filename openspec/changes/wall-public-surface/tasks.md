## 1. The audience declaration

- [x] 1.1 Add `audience: "public" | "operator"` to the window type (`src/wall/types.ts`) and carry it onto `ResolvedWindow` and `Client` (D1).
- [x] 1.2 Resolve it fail-closed: missing or unreadable → `"public"`, with a warning naming the window (D1/D2).
- [x] 1.3 Warn when a window's declared audience and its zone filter disagree, and resolve toward the protected reading.
- [x] 1.4 Declare the audience explicitly on both shipped windows (`én` → `operator`, `fal` → `public`) so a default install is unchanged (D2).

## 2. Rewire the pivot

- [x] 2.1 Make `isPublicClient` (`src/wall/server.ts:643-645`) a single accessor over the declaration, with a comment naming this change and the leak it closes (risk 3).
      **Deviation from D1, tightening it:** written as `client.audience !== "operator"`, not
      `=== "public"`. The test fixtures build `ResolvedWindow` literals directly (bypassing
      `resolveWindow`, and not in the `tsc` build program), which showed that `=== "public"`
      makes an *unset* field mean "not public → no redaction" — the original defect wearing a
      new field name. The fail-closed reading now holds even for a window that never passed
      through `resolveAudience`.
- [x] 2.2 Verify by inspection that every consumer is unchanged in behavior for the shipped config: `broadcastEvent`, `replay`, the `stage-expired` suppression, and the zoned `show`.
      Accumulation is split by the *event's* zone (`reachesPrivate`/`reachesPublic` in
      `accumulate`), never by the client's, so no private content is in a public slice for
      `replay` to hand out regardless of what a window's zone list admits.
- [x] 2.3 Enforce the private-zone gate for a public surface at broadcast, independently of the zone filter (D3).
      **Extended past the display event:** the inspection in 2.2 found `show` and `pending`
      still gated on the zone filter alone. Both carry content — a `show` carries the visual
      id (free producer text, zoned for exactly that reason) and a `pending` its label — so
      the gate is applied to them too, in the same place.

## 3. Tests

- [x] 3.1 A window with no `audience` resolves to public — the fail-closed default, named so a future re-inference breaks it.
- [x] 3.2 A legacy public window with `private` in its zones: redaction still applies, and a private-zone event does not reach it.
- [x] 3.3 A disagreement warns, and the protected reading wins.
- [x] 3.4 An `operator` window still receives private events and the private accumulation slice, exactly as today.
- [x] 3.5 The shipped default config resolves to the same protection as before this change (a regression fence for D2) — asserted against the *old* inference expression itself, so the fence states the equivalence rather than restating today's constants.

All in `src/wall/audience.test.ts` (12 tests): the pure resolution half via `resolveWindow`,
the wire half against a real `WallServer` over genuine SSE clients.

## 4. Parity as configuration

- [x] 4.1 Ship (or document) the parity shape: a public wall carrying the mirror + narration + pinned boxes, and the single-public-window case with no operator window at all (D4).
      Documented, not shipped as a new default: adding a window to `DEFAULT_WINDOWS` would
      change a default install, which D2 forbids. Both shapes in `docs/wall-public-parity.md`,
      and both were resolved through `resolveWindows` to confirm they are valid (no warnings,
      expected boxes) rather than plausible-looking JSON.
- [x] 4.2 Write the box policies for it, following the existing mandate-not-zone pattern.
- [x] 4.3 Document the distinction operators need: parity is the same **boxes**, not the same **feed** — a public mirror box shows what was emitted to a shared zone and survived redaction.

## 5. Docs

- [x] 5.1 Update CLAUDE.md's wall section: audience and zone are different axes; `zone: "private"` is still the only reliable content gate; widening a window's zones is not how you show more publicly.
- [x] 5.2 Note the fail-closed default and the warning in the same place, so an operator who hits the warning finds the reason.

Also: `docs/README.md` links the new parity page.

## 6. Verify

- [x] 6.1 `npm run build` clean under `tsc` strict; `npm test` green (438 tests, 28 files).
- [x] 6.2 Run the wall with the shipped config and confirm identical behavior to before (redaction badge, private staging, public narration).
      Live on port 8791, real SSE clients on both routes: no warnings at resolution; a
      `[belső]` span reached `/wall` as `"ajánlat […]"` and `/` as the full text with
      `"redaction":"redacted"`; a `zone:"private"` súgás reached only `/`.
- [x] 6.3 Configure a public window with `private` in its zones; confirm the warning, that redaction still runs, and that a private event never reaches it.
      A widened `fal` (`zones: public/both/private`) still received only the scrubbed
      variant and never the private súgás — the D3 gate, with the zone filter admitting it.
      The same run carried an undeclared private window: it warned with the one-field fix and
      resolved public, i.e. it got the *redacted* copy and no private event (D2's deliberate
      direction).
- [x] 6.4 Run the single-public-window shape and confirm the operator's own session is unaffected.
      The documented shape B ran alone on its own runtime dir while the shipped-config wall
      kept running: the projector window got only the scrubbed line, and the operator's wall
      went on delivering private súgás and the redaction marker unchanged.

Additional (design open question, decided at apply time): the startup banner now prints each
window's **resolved** audience, so the fail-closed default is visible on a config that did not
trip a warning — `régi-privát ... (public, zones: private/both, ...)` reads as the problem it is.
