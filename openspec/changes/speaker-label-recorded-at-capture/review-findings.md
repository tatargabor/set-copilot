# Review findings — speaker-label-recorded-at-capture

## Round 1 — 2026-10-07

Reviewers: adversarial-code-reviewer (blind), rules-conformance-auditor (blind)

### Status
| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| M1 | MAJOR | Parse-time replacement of `line.speaker` merges the two channels' rebuild when a config resolves both labels equal — overlap marks gone, cross-channel reassembly | RESOLVED — design rewritten: the label rides beside the channel; the channel stays the grouping key; resolution at render |
| M2 | MAJOR | "Terminal label" contradicted the chosen mechanism: `opts.speakers[label] ?? label` lets a label-keyed config entry rewrite it | RESOLVED — resolution is `speakerName ?? map ?? channel`, label terminal by construction; spec scenario kept, task 2.1 verifies it |
| M3 | MAJOR | The ADDED requirement falsifies the base scenario "Speaker labels come from configuration" for post-field recordings — must be MODIFIED with the scenario reframed | RESOLVED — transcript-stitch delta now carries the MODIFIED requirement with the scenario narrowed + a new identical-attribution scenario |
| m4 | MINOR | The wall transcript page re-derives labels from the serving machine's map — the same re-attribution in a sibling path | RESOLVED — new wall-transcript-page delta (MODIFIED, scenario added); task 2.2; design Decision; proposal Impact |
| m5 | MINOR | Wrong citations: `parseTranscript` (→ `parseLines`), `--speaker` (→ `--speakers`), a `--stats` speaker list that does not exist, "exactly two channels" (dictation is single-channel) | RESOLVED — design/tasks/proposal corrected |

### Findings
#### M1 — parse-time speaker replacement merges channels (MAJOR)
- **Source:** adversarial-code-reviewer
- **Claim:** Resolving `line.speaker` to the recorded label at parse time changes structurally more than the name: the rebuild filters by `speaker` (`transcript-build.ts:323`), overlap is `o.speaker !== s.speaker` (`:422`), rotation clocks group by `speaker` (`:219`) — a config resolving both channels to one label would merge the rebuild in file order, the cross-channel reassembly the base spec forbids, with every overlap mark gone, where today's identical config error is cosmetic.
- **Fix:** The label rides beside the channel (`StitchLine.speakerName`, sentence carries the channel's label), and every renderer resolves `speakerName ?? map ?? channel`. Channel identity preserved; the degenerate case degrades cosmetically, with a spec scenario pinning it.
- **Status:** RESOLVED — design.md Decisions (rewritten); specs/transcript-stitch delta (requirement text + new scenario "Equal labels do not merge the channels"); tasks.md 2.1

#### M2 — terminality contradicted the mechanism (MAJOR)
- **Source:** adversarial-code-reviewer
- **Claim:** "Resolve at parse, let `opts.speakers[label] ?? label` fall through" presumes the map never keys the label; the spec scenario and task 2.1 demand a label-keyed entry NOT rewrite — the design's own mechanism could not satisfy its spec.
- **Fix:** `speakerName ?? opts.speakers[channel] ?? channel` — the label is consulted first and is terminal by construction. The open product question (immutable even against an explicit `--speakers` override?) resolved YES: the change's own premise is that no later machine's config re-attributes; a recorded-wrong label is corrected at the capturing machine and by re-recording. Recorded in design.
- **Status:** RESOLVED — design.md Decisions; specs/transcript-stitch delta scenario wording

#### M3 — the base scenario is falsified; ADDED dodges the carry-forward check (MAJOR)
- **Source:** adversarial-code-reviewer
- **Claim:** Base `transcript-stitch` "Speaker labels come from configuration" (`openspec/specs/transcript-stitch/spec.md:230-234`) cannot coexist with the new SHALL for post-field recordings; archiving as ADDED merges a self-contradictory spec.
- **Fix:** The delta MODIFIES "The stitch emits a readable and a structured artifact" — base prose carried, the configuration scenario narrowed to recordings without a recorded label, a new scenario pinning both artifacts to the same resolution — alongside the ADDED requirement.
- **Status:** RESOLVED — specs/transcript-stitch/spec.md (MODIFIED + ADDED)

#### m4 — the wall transcript page re-attributes too (MINOR)
- **Source:** adversarial-code-reviewer
- **Claim:** `transcriptPageLine` (`src/wall/server.ts:1348`) labels from the serving machine's map; `speakerName` appears nowhere under `src/wall/`. A moved recording renders `gazda` in the `.md` and the map's name on the live page.
- **Fix:** A third delta (wall-transcript-page, MODIFIED with a scenario) + task 2.2 + design decision.
- **Status:** RESOLVED — specs/wall-transcript-page/spec.md; tasks.md 2.2; design.md; proposal.md

#### m5 — citations that misdirect apply (MINOR)
- **Source:** adversarial-code-reviewer
- **Claim:** `parseTranscript` does not exist (`parseLines` does, `transcript-build.ts:142`); the flag is `--speakers` (`cli.ts:911`); `formatStats` has no per-speaker output; dictation is single-channel.
- **Fix:** All four corrected in design/tasks/proposal; the `--stats` claim dropped.
- **Status:** RESOLVED — design.md, tasks.md, proposal.md

### Rules verdicts
The rules-conformance-auditor reported **no FAIL**: PASS on config-seam reuse, test scope and CLI verification, no skill fork, runtime-dir invariants untouched, confidentiality (role words, no names), IN/OUT OF SCOPE, `[REQ:]` traceability, per-group tests, review gate correctly pending, observable-behaviour gate, whole-surface, reuse-before-build, verify-gate expectations, additive-only change, file-reference hygiene. N-A on wall safety axes, archive-time process, E2E/Python/design-export frameworks, and process rules. Its check "both ADDED names are genuinely new" was correct for `live-transcript-format` and initially for `transcript-stitch` — the adversarial reviewer's M3 showed the base SCENARIO (not requirement name) contradiction that makes the MODIFIED necessary; resolved as above.

### Checked and found OK
- (adversarial-code-reviewer) No domain hardcoding; no word-boundary surface; poll's echo dedup and fast-lane triggers unaffected; runtime-dir invariants untouched; config already machine-first for `mic`; no migration step needed; skills' raw-line docs stay true; `renderPlain` (dictation print) uses no speakers; recovery ledger and replay paths speaker-agnostic; `capture.ts:162` is the only production writer construction; `--speakers` already merges over config in `stitchFile`, so the fallback behaviour falls out; no sibling-change clash; recent history checked.
- (rules-conformance-auditor) Format conforms; both capabilities reused, no near-duplicates; traceability complete; the one path without a unit test gets a CLI run per CLAUDE.md; no confidentiality leak.

### Open decisions (the user's)
- Resolved for autonomous continuation (recorded in design.md; revisit if you disagree):
  1. **A recorded label is terminal even against `--speakers`** — the change's premise; correction happens at the capturing machine.
  2. **A degenerate equal-label config degrades cosmetically** — with channel identity preserved internally it cannot corrupt the transcript, so no refusal is needed.
