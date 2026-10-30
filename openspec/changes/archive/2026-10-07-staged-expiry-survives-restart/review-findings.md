# Review findings — staged-expiry-survives-restart

## Round 1 — 2026-10-07

Reviewers: adversarial-code-reviewer (blind), rules-conformance-auditor (blind)

### Status
| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| C1 | CRITICAL | The staged delta's `emittedAt` never reaches the registration site — `normalizeEvent` strips it; only `normalizePromote` was fixed | RESOLVED — design.md "The server reads the stamp from the raw line", tasks.md 2.1 |
| M1 | MAJOR | The live `Date.now()` fallback for an unstamped line contradicts the base `wall-feed` requirement "An event with no emission time is read as unknown" | RESOLVED — design.md "Fail closed on a missing stamp, live and replayed alike"; specs/wall-feed delta adds the MODIFIED requirement |
| m1 | MINOR | A forged/future-dated stamp can revive an expired prediction; trust boundary unstated | RESOLVED — design.md "A stamp that cannot be honest is refused"; specs/predictive-staging requirement + scenario "A stamp that cannot be honest is refused"; tasks.md 2.3 |
| m2 | MINOR | Existing `emit.test.ts` exact-equality promote case breaks; task 1.1 did not name it | RESOLVED — tasks.md 1.1 verify clause |
| m3 | MINOR | "Same promote decisions on rebuild" is false if `wall.staging.ttlMs` changed between runs | RESOLVED — specs/predictive-staging requirement ("for an unchanged `wall.staging.ttlMs`") + OUT OF SCOPE line |
| m4 | MINOR | The `replay` callback argument's optionality/default unspecified; real forwarding site is `WallServer.start` | RESOLVED — the replay signal is dropped entirely (design.md "Fail closed … no replay signal is needed"); tasks.md section 2 rewritten |

### Findings
#### C1 — the gate can never read the delta's stamp (CRITICAL)
- **Source:** adversarial-code-reviewer (verified against code by the session)
- **Claim:** The plan's core mechanism — "register a staged prediction with the delta's `emittedAt`" — cannot be implemented as written: `normalizeEvent` copies a field allowlist that drops `emittedAt`, and `ingest` replaces the raw line with the normalized event before the registration site runs, so `msg.emittedAt` is `undefined` for every staged delta, live or replayed.
- **Evidence:** `src/wall/emit.ts:187-202` (allowlist), `src/wall/server.ts:752` (`msg = norm.event`), `src/wall/server.ts:773-775` (registration reads `Date.now()`). The plan fixed exactly this stripping for the promote path only (`normalizePromote`).
- **Failure scenario:** Apply tasks 1–4 literally → a replayed staged delta stamped `T0` falls back to `Date.now()` at registration → promotable for another full window: the defect the change exists to fix, still present in the registration half.
- **Fix:** `ingest` captures a finite numeric `emittedAt` from the raw line before the reassignment; `normalizePromote` carries the stamp for the promote path. Recorded in design.md; task 2.1 implements it. The wire shape is untouched.
- **Status:** RESOLVED — design.md "The server reads the stamp from the raw line, before normalization"; tasks.md 2.1

#### M1 — live fallback substitutes the current time for a missing stamp (MAJOR)
- **Source:** adversarial-code-reviewer; the rules-conformance-auditor examined the same point and read the base requirement as measurement-scoped (finding merged)
- **Claim:** "Live, a line without `emittedAt` … the server treats as stamped 'now'" violates the untouched base requirement "An event with no emission time is read as unknown" ("SHALL NOT substitute … the current time"), and the base scenario "An older log still replays … exactly as before" no longer holds for the staging subset.
- **Evidence:** `openspec/specs/wall-feed/spec.md` (requirement + both scenarios); design.md's live-fallback sentence; `src/wall/server.ts:774` (the substitution exists today).
- **Failure scenario:** The change archives with two requirements in tension; a later reader enforcing one breaks the other.
- **Fix:** The stricter branch of the reviewer's own disjunction: the gate never substitutes — an unstamped staged delta is not promotable and an unstamped promote publishes nothing, live and replayed alike. Nothing live depends on the fallback (`wall-emit` stamps everything in the log; the fake feed emits no staged/promote lines), which also removes the `EventSource` signature change. The wall-feed delta adds the MODIFIED requirement carrying both base scenarios (one reframed to its surviving intent). The auditor's narrower reading is subsumed: uniform fail-closed conforms under both readings.
- **Status:** RESOLVED — design.md "Fail closed on a missing stamp, live and replayed alike — no replay signal is needed"; specs/wall-feed/spec.md delta (second MODIFIED requirement)

#### m1 — forged or future-dated stamp revives an expired prediction (MINOR)
- **Source:** adversarial-code-reviewer
- **Claim:** Judging a promote at its own `emittedAt` trusts a stamp any direct log appender can write, so "a promote that was refused stays refused" holds only against `wall-emit` users.
- **Evidence:** `src/wall/server.ts:663-674` (direct-append seam), `src/wall/types.ts:274-279` (trust boundary does not contemplate reviving an expired prediction).
- **Failure scenario:** A direct appender writes a promote with a stamp inside the long-expired window; the gate publishes the stale guess.
- **Fix:** Refuse a promote stamped later than the processing clock or earlier than the staged prediction's registration stamp; state the residual trust boundary in design. Implemented as task 2.3; the requirement text and a scenario carry it in the delta.
- **Status:** RESOLVED — design.md "A stamp that cannot be honest is refused like a missing one"; specs/predictive-staging/spec.md; tasks.md 2.3

#### m2 — existing exact-equality promote test breaks unmentioned (MINOR)
- **Source:** adversarial-code-reviewer
- **Claim:** `emit.test.ts` asserts the promote line equals exactly `{kind, category, visual, zone}` with no `emittedAt`; task 1.1's verify list never names updating it.
- **Evidence:** `src/wall/emit.test.ts:262-267` ("writes a promote command, defaulting its zone to public").
- **Failure scenario:** Task 1.1 lands; the exact-equality case fails as an apparent regression.
- **Fix:** Named in task 1.1's verify clause.
- **Status:** RESOLVED — tasks.md 1.1

#### m3 — rebuild parity is silently conditional on the ttl (MINOR)
- **Source:** adversarial-reviewer finding 5 (adversarial-code-reviewer)
- **Claim:** "A rebuild reaches the same promote decisions the live wall reached" is false if `wall.staging.ttlMs` changed between the runs; the ttl is not in the log.
- **Evidence:** delta requirement text; `src/wall/server.ts:573,608`; design.md rejects persisting anything but the log.
- **Failure scenario:** Operator lowers the ttl and restarts; a promote that succeeded live is refused on rebuild, violating the SHALL as written.
- **Fix:** Scope the sentence to an unchanged `wall.staging.ttlMs`, and name the config-change case in OUT OF SCOPE.
- **Status:** RESOLVED — specs/predictive-staging/spec.md (requirement text + OUT OF SCOPE)

#### m4 — the replay flag's optionality and forwarding site unspecified (MINOR)
- **Source:** adversarial-code-reviewer
- **Claim:** design.md did not say whether the `{replay}` callback argument is optional; a required one breaks external `EventSource` implementations (`WallServer` is public API), and the forwarding site is `WallServer.start`, not `addSource`.
- **Evidence:** `src/wall/event-source.ts:20-24`, `src/wall/server.ts:404`, `src/index.ts:50`, `src/wall/feed-script.ts:50-52`.
- **Failure scenario:** External sources fail `tsc` on upgrade, or an unstated default reads a missing flag as replay and fails closed on live lines.
- **Fix:** Moot — the replay signal is dropped entirely by the M1 resolution (uniform fail-closed needs no phase distinction); `EventSource` is untouched.
- **Status:** RESOLVED — design.md "no replay signal is needed"; tasks.md section 2 rewritten

### Rules verdicts
The rules-conformance-auditor reported **no FAIL**: PASS on config-not-code, test scope, runtime-dir invariants, redaction/audience posture, OpenSpec workflow (MODIFIED carries every base scenario, names verbatim, archive order satisfiable), IN/OUT OF SCOPE, `[REQ:]` traceability, per-group tests, unstated-review-skip, observable-behaviour gate, whole-surface, reuse-before-build, regression-from-field, root-cause, spec-verify-gate expectations, cross-cutting additive-ness, file-reference hygiene. N-A on skills-prompts (no skill touched), `/voice` positioning, REQ-XXX-NNN E2E prefixes, Python logging, E2E infra, design bridge/hygiene, and the process rules binding the session rather than the artifacts.

### Checked and found OK
- (adversarial-code-reviewer) The premise is true in code: a restart re-registers predictions at rebuild time and re-executes logged promotes, including one refused live. Emission-time replay reproduces live decisions across promote in/out of window, re-stage, and promote-before-delta orderings. Unstamped replay lines fail closed (safe direction). Delta-spec mechanics valid: both MODIFIED requirements exist in the base specs, every base scenario carried, `openspec validate --strict` passed. No sibling change clashes. Replay scorecard unaffected (`contentEvents` filters `kind === undefined`). `wall --reset` non-interaction holds. Audience/zone axis untouched; the rebuilt lift still re-runs `ingest` so redaction applies. No config or skill/prompt edit needed (`wall.staging.ttlMs` exists; the drawing contract teaches promote intent, not a field-exact shape). Restart tests need no CLI spawn, so no `SET_COPILOT_HOME` exposure. The wall client reads neither `emittedAt` nor promote lines.
- (rules-conformance-auditor) Traceability complete (every task tagged; both requirements covered); the wall-feed "control line is not stamped" scenario correctly reframed to `pending`/`layout` with the flipped half given its own scenario; OUT OF SCOPE items genuinely deferred and no task reaches into them; confidentiality held (no entity names); invariants preserved (log append/rotate-only; fail-closed direction; live behaviour change bounded at ≤ 200 ms).

### Open decisions (the user's)
- Resolution recorded for autonomous continuation (this review ran inside an unattended batch; both options satisfy the delta spec — revisit if you prefer the other):
  1. **How the gate reads the staged delta's stamp**: chosen = capture the raw log-line stamp in `ingest` before normalization (no wire change), not carrying `emittedAt` through `normalizeEvent` (which would put the field on every SSE event, both redaction variants, and the `latest`/scroll stores — an observable surface change no artifact asks for). This matches proposal.md's Impact, which already scoped the carry to `normalizePromote` + server.ts.
  2. **Live unstamped lines**: chosen = fully fail-closed (no substitution anywhere), the stricter branch of the reviewer's disjunction; the measurement-scoped reading of the base requirement is subsumed.
