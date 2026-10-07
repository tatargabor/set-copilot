# Tasks

## 1. Promote lines carry their emission time

- [ ] 1.1 In `src/wall/emit.ts`, stamp an appended `promote` line with `emittedAt` from the append path (overwriting any supplied value), as display events are; leave `pending` and `layout` unstamped. Verify: new `src/wall/emit.test.ts` cases — a promote line carries a numeric `emittedAt`; a producer-supplied one is overwritten; `pending`/`layout` lines carry none; the existing "writes a promote command, defaulting its zone to public" exact-equality case is updated for the stamp. [REQ: Every appended event records when it was emitted]
- [ ] 1.2 Make `normalizePromote` carry a finite numeric `emittedAt` through to the `Promote` it returns (and add the optional field to the `Promote` type in `src/wall/types.ts`). Verify: an `emit.test.ts` case normalizing `{kind:"promote", …, emittedAt: 123}` keeps 123, and a non-numeric one yields no field. [REQ: Every appended event records when it was emitted]

## 2. The gate decides by emission time

- [ ] 2.1 In `src/wall/server.ts` `ingest`, capture a finite numeric `emittedAt` from the raw line BEFORE `normalizeEvent` replaces it, and register a staged prediction with that stamp instead of `Date.now()`. A staged delta with no usable stamp — replayed or live — is shown privately but is NOT registered as promotable. Verify: `server.staging.test.ts` case "an unstamped staged delta is shown privately but is not promotable". [REQ: An unused prediction expires quietly]
- [ ] 2.2 Judge a promote at its own `emittedAt`; a promote with no usable stamp — replayed or live — publishes nothing. Keep the existing retire-on-stale behaviour. Verify: existing staging tests still pass. [REQ: An unused prediction expires quietly]
- [ ] 2.3 Refuse a nonsense stamp: a promote whose `emittedAt` is later than the processing clock, or earlier than the staged prediction's registration stamp, publishes nothing and leaves the registry intact. Verify: `server.staging.test.ts` cases for both refusals. [REQ: An unused prediction expires quietly]

## 3. Restart tests

- [ ] 3.1 Add restart tests to `src/wall/server.staging.test.ts`, each building a log file and starting a fresh server over it with a short `stagingTtlMs`: (a) a staged delta older than the window is not promotable after the rebuild and a public client receives nothing from it; (b) a log with a staged delta plus a promote stamped after the window publishes nothing on rebuild; (c) a log with a promote stamped inside the window rebuilds the promoted visual into the public replay; (d) an unstamped promote in the replayed log publishes nothing. Verify: `npx vitest run src/wall/server.staging.test.ts` passes, and (a)/(b) fail against the pre-change code. [REQ: An unused prediction expires quietly]

## 4. Whole-suite check

- [ ] 4.1 Run `npm run build && npm test`; both pass. [REQ: An unused prediction expires quietly]
