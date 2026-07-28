## 1. The audience declaration

- [ ] 1.1 Add `audience: "public" | "operator"` to the window type (`src/wall/types.ts`) and carry it onto `ResolvedWindow` and `Client` (D1).
- [ ] 1.2 Resolve it fail-closed: missing or unreadable → `"public"`, with a warning naming the window (D1/D2).
- [ ] 1.3 Warn when a window's declared audience and its zone filter disagree, and resolve toward the protected reading.
- [ ] 1.4 Declare the audience explicitly on both shipped windows (`én` → `operator`, `fal` → `public`) so a default install is unchanged (D2).

## 2. Rewire the pivot

- [ ] 2.1 Make `isPublicClient` (`src/wall/server.ts:643-645`) a single accessor over the declaration, with a comment naming this change and the leak it closes (risk 3).
- [ ] 2.2 Verify by inspection that every consumer is unchanged in behavior for the shipped config: `broadcastEvent` (`:648-658`), `replay` (`:714`, `:722`, `:732`), the `stage-expired` suppression (`:436`), and the zoned `show`.
- [ ] 2.3 Enforce the private-zone gate for a public surface at broadcast, independently of the zone filter (D3).

## 3. Tests

- [ ] 3.1 A window with no `audience` resolves to public — the fail-closed default, named so a future re-inference breaks it.
- [ ] 3.2 A legacy public window with `private` in its zones: redaction still applies, and a private-zone event does not reach it.
- [ ] 3.3 A disagreement warns, and the protected reading wins.
- [ ] 3.4 An `operator` window still receives private events and the private accumulation slice, exactly as today.
- [ ] 3.5 The shipped default config resolves to the same protection as before this change (a regression fence for D2).

## 4. Parity as configuration

- [ ] 4.1 Ship (or document) the parity shape: a public wall carrying the mirror + narration + pinned boxes, and the single-public-window case with no operator window at all (D4).
- [ ] 4.2 Write the box policies for it, following the existing mandate-not-zone pattern.
- [ ] 4.3 Document the distinction operators need: parity is the same **boxes**, not the same **feed** — a public mirror box shows what was emitted to a shared zone and survived redaction.

## 5. Docs

- [ ] 5.1 Update CLAUDE.md's wall section: audience and zone are different axes; `zone: "private"` is still the only reliable content gate; widening a window's zones is not how you show more publicly.
- [ ] 5.2 Note the fail-closed default and the warning in the same place, so an operator who hits the warning finds the reason.

## 6. Verify

- [ ] 6.1 `npm run build` clean under `tsc` strict; `npm test` green.
- [ ] 6.2 Run the wall with the shipped config and confirm identical behavior to before (redaction badge, private staging, public narration).
- [ ] 6.3 Configure a public window with `private` in its zones; confirm the warning, that redaction still runs, and that a private event never reaches it.
- [ ] 6.4 Run the single-public-window shape and confirm the operator's own session is unaffected.
