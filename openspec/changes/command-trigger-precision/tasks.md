## 1. Lane rules

- [x] 1.1 `FastLaneConfig` gains `channels`, `utteranceStart`, `utterancePauseMs`; `feed` ignores a speaker not in `channels` before touching state (design D1) [REQ: Only configured channels open a command]
- [x] 1.2 Utterance-aware opener, pause clock per speaker, placeholder on truncation and abandonment (design D2) [REQ: The opening word must begin an utterance]
- [x] 1.3 Unit tests with invented sentences for every spec scenario; existing tests keep passing [REQ: Only configured channels open a command] [REQ: The opening word must begin an utterance]

## 2. Config and policy

- [x] 2.1 `DEFAULT_FAST_LANE` and resolution of the new keys (design D3) [REQ: Default opening words exclude ordinary verbs] [REQ: Only configured channels open a command]
- [x] 2.2 Config tests: defaults, overrides, malformed values [REQ: Only configured channels open a command]
- [x] 2.3 `renderFastLane` names the rule (design D5) [REQ: The opening word must begin an utterance]

## 3. Measurement and docs

- [x] 3.1 `scripts/fast-lane-replay.ts`, read-only (design D4) [REQ: A replay command measures false openings]
- [x] 3.2 CLAUDE.md fast-lane paragraph [REQ: Default opening words exclude ordinary verbs]
- [x] 3.3 `npm run build` and `npm test` pass [REQ: Only configured channels open a command]

## Acceptance Criteria (from spec scenarios)

- [x] AC-1: The replay command prints per-speaker counts and leaves its input unchanged [REQ: A replay command measures false openings, scenario: Counting a recorded meeting]
- [x] AC-2: A system-channel opener produces no event with default config [REQ: Only configured channels open a command, scenario: Opener on the system channel]
- [x] AC-3: A remote "start … stop" produces no command [REQ: Only configured channels open a command, scenario: A completed bracket from a remote participant]
- [x] AC-4: The name mid-sentence opens no span [REQ: The opening word must begin an utterance, scenario: The name used mid-sentence]
- [x] AC-5: A sentence-initial mic address, whole or split, still emits a command [REQ: The opening word must begin an utterance, scenario: Address at the start of a sentence]
- [x] AC-6: "start" in ordinary speech opens no span with default config [REQ: Default opening words exclude ordinary verbs, scenario: "start" in ordinary speech]
