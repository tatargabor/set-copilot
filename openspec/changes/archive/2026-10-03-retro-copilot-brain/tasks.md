# Tasks

Retro-spec: every task verifies existing behaviour against the code; no code is changed.

## 1. knowledge-digest

- [x] 1.1 Verify the digest writes keyword-index.json, knowledge-context.json and knowledge-digest.md into the runtime dir, stamps `generated`, and prints the summary line against src/knowledge/run-digest.ts:159 and src/cli.ts:140 [REQ: The digest writes three artifacts into the runtime dir]
- [x] 1.2 Verify `"markdown"`/absent selects the built-in adapter and any other value is imported as a project-relative module whose non-function default export is refused by name against src/knowledge/run-digest.ts:106 [REQ: The knowledge adapter is pluggable through config]
- [x] 1.3 Verify directory/file/glob resolution (`**/` zero-or-more dirs, `*` and `?` within one segment), dotfile and node_modules skipping, dedupe + sort, and silent skip of non-matching entries against src/knowledge/sources.ts:16 and src/knowledge/sources.ts:72 (tests src/knowledge/sources.test.ts:30-94) [REQ: Sources resolve directories, files and small globs]
- [x] 1.4 Verify topic derivation from frontmatter tags/topics/keywords, the `#` title and `##` headings, the furniture list and topic-like limits, the 200 cap, seeds-first precedence, and autoKeywords=false returning seeds only against src/knowledge/markdown-adapter.ts:34, :114, :205-226 [REQ: Topics are derived from the pages themselves]
- [x] 1.5 Verify grouped keywords are flattened, malformed seeds dropped, and the knowledge section merged per key across user and project configs against src/config.ts:974 and src/config.ts:1078 [REQ: Keyword seeds are a flat list; named groups are flattened]
- [x] 1.6 Verify the meeting capture (not dictation) loads the index and the matcher matches at a Unicode word start, inside inflected forms, deduped in index order, with an absent/invalid index yielding no topics against src/capture.ts:155, src/knowledge/keyword-matcher.ts:9, :39, :71 [REQ: The capture tags transcript lines with matched topics]
- [x] 1.7 Verify company-suffix stripping, separator tolerance, the word-end requirement at ≤4 characters and no stem below 3 characters against src/knowledge/keyword-matcher.ts:88-107 (tests src/knowledge/keyword-matcher.test.ts:48-62) [REQ: Entity names become safe stems]
- [x] 1.8 Verify `DEC-3` / `dec 12` normalise to `DEC-003` / `DEC-012`, the bare prefix does not match, and ids follow the topics against src/knowledge/keyword-matcher.ts:44-66 (tests src/knowledge/keyword-matcher.test.ts:36-44) [REQ: Decision references are recognised without an index rebuild]
- [x] 1.9 Verify decisions (superseded skipped, 240-char summary), deferred items (marker match, ticket id, 200 chars, cap 100, empty markers → defaults), domain FAQ (≤8 headings) and 30-day fix commits (≤30, none without git) against src/knowledge/markdown-adapter.ts:130, :147, :166, :182 and src/config.ts:501, :1162 [REQ: The markdown adapter builds a structured context from the pages]
- [x] 1.10 Verify the digest renders only non-empty sections and otherwise names `knowledge.sources` against src/knowledge/markdown-adapter.ts:67-100 (test src/knowledge/markdown-adapter.test.ts:104) [REQ: The digest says so when it has nothing]

## 2. copilot-policy

- [x] 2.1 Verify the section order, the unconditional wall-input block, the narration/mirror/drawing/box/instructions gating and the append-only invariant against src/copilot-prompt.ts:340-353 and :442-473, and the skill's `set-copilot prompt` call at skills/meeting-copilot/SKILL.md:77 [REQ: The policy is rendered from config and composed in a fixed order]
- [x] 2.2 Verify the four default categories, invalid-entry dropping with fallback to defaults, priority ordering, label rendering, verbatim `when`, and the notify command only for `notify` categories against src/config.ts:419, :1053, :1172 and src/copilot-prompt.ts:306-338 [REQ: The alert taxonomy is data with defaults]
- [x] 2.3 Verify the alert block states alerts are chat-only and never a `wall-emit` against src/copilot-prompt.ts:320-326 [REQ: Alerts are chat-only]
- [x] 2.4 Verify the silent/reactive/participant texts and the fallback of an unknown engagement to reactive against src/copilot-prompt.ts:31-55 and src/config.ts:1173 (tests src/copilot-prompt.test.ts:166-188) [REQ: Engagement sets how much of a voice the copilot has]
- [x] 2.5 Verify maxLines is floored when positive and falls back to 3, and is rendered as the per-contribution budget against src/config.ts:1176 and src/copilot-prompt.ts:64 [REQ: Each contribution has a line budget]
- [x] 2.6 Verify web research is rendered only for `allowWebResearch === true` against src/config.ts:1186 and src/copilot-prompt.ts:58-63 (test src/copilot-prompt.test.ts:189) [REQ: Web research is mentioned only when allowed]
- [x] 2.7 Verify the always-rendered turn-order block (reaction alone, then one batch, then back to listening; ordering never drops content) against src/copilot-prompt.ts:118-131 (test src/copilot-prompt.test.ts:152) [REQ: The reaction goes out first]
- [x] 2.8 Verify the fast-lane block names the configured markers, ranks a command ahead of the turn order, says act on the event not the line, forbids executing an abandoned command, and is absent when disabled against src/copilot-prompt.ts:91-116 (tests src/copilot-prompt.test.ts:114-143) [REQ: Spoken commands are taught when the fast lane is on]
- [x] 2.9 Verify the drawing block's gating, category listing, payload shapes, promote command, `[belső]` rule, verbatim conventions, empty-list honouring vs absent fallback, and hand-built-config tolerance against src/copilot-prompt.ts:245-304, :461-467 and src/config.ts:1188-1194 [REQ: The drawing contract block teaches the wall]
- [x] 2.10 Verify the instructions file is resolved against the project root and appended verbatim last, absent key renders nothing, and a missing file yields a notice naming the path against src/copilot-prompt.ts:362-369 and :470-471 (tests src/copilot-prompt.test.ts:83-96) [REQ: The project's own instructions are loaded verbatim]

## 3. deck-knowledge

- [x] 3.1 Verify the `dia <n>: <title>` topic, the ≥5-char / capitalised ≥3-char word rule, the `max(2, ceil(30%))` frequency filter and dropping stemless slides against src/knowledge/run-digest.ts:36-68 (tests src/knowledge/run-digest.test.ts:22-65) [REQ: A slide's keyword tags are its distinctive title words]
- [x] 3.2 Verify the build-identifier test (`/` or no whitespace), heading preference with identifier fallback, and `<title>`/`<head>` removal from slide text against src/knowledge/deck.ts:121-165 [REQ: An export's build identifier is not taken as a slide title]
- [x] 3.3 Verify the pipeline appends slide topics, sets `deck` in the context and appends the deck digest after any adapter, resolves the four deck extensions, and reports `deck configured but EMPTY` and failed files in the summary against src/knowledge/run-digest.ts:13, :19, :147-170 [REQ: Deck awareness does not depend on the knowledge adapter]

## 4. replay-scenario

- [x] 4.1 Verify the 16-hex SHA-256 fingerprint over key-sorted meta (minus `noiseBand` and `_`-keys), script and expectations against src/replay-scenario.ts:277-302 (tests in src/replay-scenario.test.ts added by f6f64da) [REQ: A scenario's fingerprint covers what changes a score, and nothing else]
- [x] 4.2 Verify `noiseBand` is an optional meta map read as declared by `replay-score compare --scenario` and never computed by the engine against src/replay-scenario.ts:118-132 and src/cli.ts:191-211 [REQ: A scenario may declare its measured noise band]
- [x] 4.3 Verify `reactionCategories` restricts precision's reactions and its absence counts every category, as stated in the precision detail, against src/replay-scenario.ts:105-117 and src/replay-score.ts:344-365 [REQ: A scenario declares which categories count as reactions]

## 5. replay-scorecard

- [x] 5.1 Verify fingerprint refusal, in-band "unchanged" with note, no-band "reading, not evidence" note, unmeasurable reporting, ungraded activity counts and non-zero exit on refusal against src/replay-score.ts:435-495 and src/cli.ts:210 [REQ: Two runs of one scenario are comparable]
- [x] 5.2 Verify the persisted per-moment `judgement` (index, alsoAddressing, delayMs, reasoning), the unanswered-moment record and discarding of unoffered indexes against src/replay-score.ts:105-124, :397-407 and src/replay-judge.ts:105-136 [REQ: The judged matching is recorded in the scorecard, per moment]
- [x] 5.3 Verify earliest-event crediting, `alsoAddressing` counting as addressed, exclusion of unpromoted staged predictions, event-log index space, and the legacy fallback against src/replay-judge.ts:86-93 and src/replay-score.ts:70-86, :330-365 [REQ: Precision credits every event that addresses a planted moment]

