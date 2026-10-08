## 1. Config: one shipped window

- [x] 1.1 Replace `DEFAULT_WINDOWS` with the single `fal` window (route `/wall`, audience `public`, layout `három-régió`, boxes szöveg/prezentáció/kitűzött), keeping the public-safe mandate text and the unpaced `kitűzött` box; delete the `én` window
- [x] 1.2 Relocate the staging mandate from the deleted `én.staging` box policy into `DEFAULT_DRAWING_CONVENTIONS` (prepare in a `silence` window, `zone:"private"`, `staged:true`, `visual` id required, promote only when the conversation arrives, expiry is the correct outcome for a wrong guess, `wall-staged` answers what is prepared)
- [x] 1.3 Rewrite the zone-differentiated narration comment and the `DEFAULT_WINDOWS` preamble for the single-surface reality; keep `riasztás`/`súgás` in `DEFAULT_CATEGORIES` and out of every wall box

## 2. Server: root redirect + pending scrub

- [x] 2.1 In `WallServer.handle`, redirect `GET /` (302) to the first declared window route when no window claims `/`; serve normally when one does
- [x] 2.2 In the `isPending` ingest branch, when the marker's zone reaches a public client and a redactor is configured: scrub the label; drop the marker when it still matches after scrubbing or when scrubbing throws; private-only markers keep the raw label

## 3. Producer policy

- [x] 3.1 `copilot-prompt.ts` narration block: emit `zone:"both"`, redaction-backed rule (`[belső]` marking, never raw transcript); cadence/verbosity bullets byte-identical
- [x] 3.2 `copilot-prompt.ts` drawing contract: state that a staged draw stays off the wall until promoted, and that `zone:"private"` now means "prepared, not shown"
- [x] 3.3 `copilot-prompt.ts` alerts block: one sentence that `riasztás`/`súgás` are chat-only (no wall box subscribes)

## 4. Skill, feed, startup, docs

- [x] 4.1 `SKILL.md`: single-wall wording for the routes; narration `zone:"both"` in the command example and prose; staging section rewritten (invisible until promoted, `wall-staged` to ask, expiry is invisible — do not wait to see it); alerts chat-only note
- [x] 4.2 `feed-script.ts`: rezone the private beats to `"both"`, add one pending beat, update the header comment
- [x] 4.3 `src/wall/index.ts` module docstring: single-window wording
- [x] 4.4 `docs/wall-public-parity.md` + `docs/wall-field-backlog.md`: short "Shipped 2026-09" notes (English) — one window by default, narration `both`, pending `both`, alerts terminal-only, staging invisible-until-promoted; backlog #8 stays open and is why a two-window project config still wins

## 5. Tests

- [x] 5.1 `audience.test.ts`: rewrite the shipped-config pins for one window (`fal` → public, no warnings, old-inference agreement over the single window)
- [x] 5.2 `config.test.ts`: narráció subscription block → the single wall's text box subscribes `narráció` + `tükör` and NOT `riasztás`/`súgás`; predictive-staging block → `előrejelzés` category exists and the public `prezentáció` box is the promote target; new case: exactly one window, route `/wall`, audience `public`, layout `három-régió`, unpaced `kitűzött`; drawing-convention block carries the staging mandate
- [x] 5.3 `emit.test.ts`: pending defaults to `both`; explicit `zone:"private"` pending still validates
- [x] 5.4 `copilot-prompt.test.ts`: rendered narration contains `zone:"both"` + `[belső]` and no "Private by default"; rendered contract contains the promoted-not-published line
- [x] 5.5 New pending-redaction server test: public-reaching label scrubbed on the wire; withheld label drops the marker; private label passes raw; no redactor configured → label passes
- [x] 5.6 New root-redirect server test: `/` → 302 to `/wall`; a window declared at `/` is served
