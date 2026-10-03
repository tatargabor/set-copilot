# Review findings — node-image-redaction-withholds

## Round 1 — 2026-10-03

Reviewers: adversarial-code-reviewer (blind), rules-conformance-auditor (blind)

### Status
| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| C1 | CRITICAL | A non-string node `image` (array) is still fetched by Cytoscape; the plan scrubbed it and pinned that with a test | RESOLVED — design.md "A node image is checked for every node of the delta, whatever its shape"; tasks.md 1.1, 1.2; public-redaction delta scenario "A non-string node image is checked too" |
| M1 | MAJOR | Whole-delta withholding does not prevent a cross-delta hole: later clean deltas of the same visual still reach public; a withheld `reset` leaves the previous topic or mixes topics | RESOLVED — D1 decided by the user (2026-10-03): hold the visual back until its next public reset; public-redaction delta paragraph + scenario, design.md Decisions, tasks.md 2.3 |
| m1 | MINOR | The producer policy (`src/copilot-prompt.ts:294`) and CLAUDE.md still name only `image.src`/`webpage.url` | RESOLVED — tasks.md 3.1; public-redaction delta IN SCOPE |
| m2 | MINOR | After a reload the private replay marks a withheld graph delta `redacted` instead of `withheld` | RESOLVED — design.md Risks; tasks.md 2.2 |
| m3 | MINOR | Failing-first order: tests came after the fix; the server test could pass without the change; malformed `nodes` entries could trip the catch-all | RESOLVED — tasks.md 1.1 (tests first, malformed-node case), 1.2 (defensive read), 2.1 (clean-sibling assertion, run before 1.2) |

### Findings

#### C1 — A non-string node `image` is fetched, and the plan scrubbed it (CRITICAL)
- **Source:** adversarial-code-reviewer
- **Claim:** design.md said a non-string `image` is not fetched because `wall.js` checks `typeof === "string"`; that check only decides the `/media` rewrite, the value is passed to Cytoscape unchanged, and `background-image` is a multiple-URL property that loads every array element.
- **Evidence:** `src/wall/public/wall.js:1291-1293` (non-string passed through as-is), `wall.js:1221` (`node[image]` → `background-image: data(image)`); Cytoscape 3.30.2 `urls` type is `multiple: true`. Re-verified by the main session at the cited `wall.js` lines.
- **Failure scenario:** a `both`-zone node `{"image": ["https://host/clients/SECRET/q3.png"]}` → scrubbed to a still-loadable URL list and fetched in front of the audience; task 1.2 asserted this as correct.
- **Fix:** every string leaf under a node's `image`, at any depth, is checked as a source.
- **Status:** RESOLVED — see table.

#### M1 — Cross-delta hole after a withheld delta (MAJOR)
- **Source:** adversarial-code-reviewer
- **Claim:** the design's reason for whole-delta withholding (no edges to a missing node) holds only within one delta; later clean `add`s of the same visual still reach the public slice (`src/wall/server.ts:799`), and a withheld `reset` leaves the previous topic in the public slice (`server.ts:147-158`), so later deltas mix topics.
- **Evidence:** `server.ts:773`, `server.ts:799`, `server.ts:973-974`, `wall.js:1432-1440`.
- **Failure scenario:** a withheld `reset` on `v2` then a clean `add` on `v2` → public shows a partial `v2` with dropped edges; or a withheld `reset` on `v1` for topic B → public `v1` shows topics A and B mixed.
- **Fix:** hold the visual's later deltas off the public zone until a public-reaching `reset` (D1).
- **Status:** RESOLVED — see table.

#### m1 — Producer policy and CLAUDE.md name only two sources (MINOR)
- **Source:** both (auditor finding 1; adversarial finding 4)
- **Evidence:** `src/copilot-prompt.ts:294`; CLAUDE.md public-zone redaction bullet.
- **Status:** RESOLVED — tasks.md 3.1.

#### m2 — Replayed private marker says `redacted` for a withheld delta (MINOR)
- **Source:** adversarial-code-reviewer
- **Evidence:** `server.ts:795` (boolean), `server.ts:1046`, `wall.js:875-878`.
- **Status:** RESOLVED — tasks.md 2.2.

#### m3 — Test order and precision (MINOR)
- **Source:** both (auditor finding 2; adversarial finding 5)
- **Evidence:** previous tasks.md 1.1/1.2 order; `src/wall/emit.ts:46-48` (nodes only checked to be an array); `src/wall/redaction.ts:265-268` (catch-all withholds).
- **Status:** RESOLVED — tasks.md 1.1, 1.2, 2.1.

### Rules verdicts

All applicable rules PASS (CLAUDE.md config-not-code, fail-closed redaction, MODIFIED vs ADDED with every base scenario carried, archive order, confidentiality; `openspec/config.yaml` IN/OUT SCOPE and `[REQ:]` tags; `.claude/rules/` opsx-before-nontrivial, regression-from-field, verify-before-claiming, reuse-before-build, bug-root-cause-investigation, spec-adversarial-review). `whole-surface-and-scope` PASS with m1. Python/E2E/design-export/orchestration `set-*` rules N-A.

### Checked and found OK
- (adversarial-code-reviewer) No domain behaviour or regex added to `src/`; the decision stays in the single `splitForZones` funnel (`server.ts:751`); a withheld variant never touches the public slice (`server.ts:798-800`); `payloadFor` returns null for it (`server.ts:887`); a promote re-enters `ingest`, so promoted staged graphs are covered; no re-export of the changed helper; tests are in-process (no `SET_COPILOT_HOME` needed); no clash with other active changes; edges carry no fetched field.
- (rules-conformance-auditor) Both delta requirement headers exist in the base specs and carry all base scenarios (2 and 4); IN/OUT SCOPE present; every task tagged and every requirement covered; no exemption claimed; confidentiality clean.

### Open decisions (the user's)
- **D1 (for M1) — decided 2026-10-03: option (a), withhold until reset.** (a) after a withheld delta, keep the visual's later deltas off the public wall until the next public-reaching `reset` (fail-closed: no hole and no topic mixing; one matching path silences that visual publicly until it is reset), or (b) keep per-delta withholding and document the cross-delta hole and stale-reset behaviour as an accepted risk.
