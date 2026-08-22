## 1. Runtime-dir ownership (highest consequence — first, per design Migration Plan)

- [x] 1.1 Extract the runtime-dir ownership rules from `src/capture.ts` into a shared module: PID acquisition, stale-PID reclaim, refusal against a live owner, and archive-don't-truncate of an unconsumed transcript. Capture keeps its behaviour byte-identical. [REQ: A replay never collides with a live capture]
- [x] 1.2 Unit-test the extracted module against all four states: no PID, live PID, stale PID, unconsumed transcript present. [REQ: A replay never collides with a live capture]
- [x] 1.3 Verify by running that `capture` + `stop` still behave identically after the extraction (start, stop, double-start refusal, archive on restart). [REQ: A replay never collides with a live capture]

## 2. Scenario format and loader

- [x] 2.1 Define the scenario's three files (lines JSONL, expectations, timeline) and their on-disk layout, including the content fingerprint that versions a scenario. [REQ: A scenario is a transcript, a ground truth, and a timeline] [REQ: A scenario is authored from any source material]
- [x] 2.2 Implement the single scenario loader used by player, timeline renderer, and scorer — one parse, three views. Reject a scenario with a missing part, naming it; report a malformed line with its position. [REQ: A scenario is a transcript, a ground truth, and a timeline]
- [x] 2.3 Implement the scenario validator: line shape, monotonic timestamps, both channels present, and the planted minimums (contradiction, open question, decision, audience speech, direct address). Reject a scenario with no planted moments. [REQ: A scenario plants ground truth deliberately]
- [x] 2.4 Unit-test the loader and validator, including each rejection path. [REQ: A scenario plants ground truth deliberately] [REQ: A scenario is a transcript, a ground truth, and a timeline]

## 3. The player — `set-copilot replay`

- [ ] 3.1 Implement deadline-based pacing (target time computed from scenario start, never accumulated sleeps), recording per-line lateness. [REQ: Playback is paced by the scenario's own timestamps]
- [ ] 3.2 Report when the player itself falls behind beyond a threshold, so a slow machine cannot be mistaken for a slow copilot. [REQ: Playback is paced by the scenario's own timestamps]
- [ ] 3.3 Implement `--speed` (default real time; a multiplier; and an as-fast-as-possible setting), and carry the speed into the run record as a validity fact, not a label. [REQ: Speed is adjustable, and a sped-up run may not claim latency]
- [ ] 3.4 Wire the shared ownership module: hold `capture.pid` for the run, refuse against a live owner, reclaim a stale PID, archive an unconsumed transcript. Release the PID at the end so the consumer observes a normal capture end. [REQ: A replay never collides with a live capture] [REQ: A replay is indistinguishable from a live capture to its consumers]
- [ ] 3.5 Write scenario lines in the transcript's own line shape, preserving two-channel interleaving in recorded order. [REQ: A replay is indistinguishable from a live capture to its consumers] [REQ: Playback is paced by the scenario's own timestamps]
- [ ] 3.6 Emit the live progress line (elapsed scenario time, section, speaker, text) and the end-of-run summary (scenario, speed, line count, wall-clock duration). [REQ: A run reports where it stands]
- [ ] 3.7 Unit-test the pure pacing decisions (what to write when, given a clock as an argument) without timers. [REQ: Playback is paced by the scenario's own timestamps]
- [ ] 3.8 Register `replay` in the CLI with `--help`, and write the run record to disk. [REQ: Speed is adjustable, and a sped-up run may not claim latency]

## 4. The readable timeline

- [ ] 4.1 Implement the timeline renderer over the loaded scenario: time, section, speaker, text, in order, with planted moments marked at their positions. [REQ: The timeline is readable and matches the lines]
- [ ] 4.2 Implement `--check` staleness detection — a timeline that disagrees with the lines is reported, not silently trusted. [REQ: The timeline is regenerated from the lines]
- [ ] 4.3 Unit-test the renderer, including a marked planted moment and a stale-timeline detection. [REQ: The timeline is readable and matches the lines]

## 5. Verify the seam end to end (before authoring a real scenario)

- [ ] 5.1 Author a deliberately tiny throwaway scenario (a couple of minutes, both channels, one planted moment) and confirm `poll` consumes it with no configuration difference from a live capture. [REQ: A replay is indistinguishable from a live capture to its consumers]
- [ ] 5.2 Run a real copilot session against that replay and confirm the wall receives events; record whether any consumer-side change proved necessary — a hidden coupling is a finding to report, not to paper over. [REQ: A replay is indistinguishable from a live capture to its consumers]
- [ ] 5.3 Run the same replay under the headless runner (`claude -p --allowedTools Bash`, Bash poll loop) and record the differences observed against the interactive run. [REQ: A replay is indistinguishable from a live capture to its consumers]

## 6. The first real scenario

- [ ] 6.1 Write the scenario-authoring runbook: how an agent turns source material into an imagined presentation, what the planted moments must cover, and how the output is validated. [REQ: A scenario is authored from any source material] [REQ: A scenario plants ground truth deliberately]
- [ ] 6.2 Author the first scenario from the reference deck (14 slides, HU), including audience questions on the system channel, direct copilot addresses, and the planted traps. Length per the design's open question — decide and record it. [REQ: A scenario plants ground truth deliberately]
- [ ] 6.3 Generate its timeline and review it as a human-readable document before it becomes a baseline. [REQ: The timeline is readable and matches the lines]
- [ ] 6.4 Confirm the harness is deck-agnostic by validating a second, structurally different stub scenario from unrelated source material with no code change. [REQ: A scenario is authored from any source material]

## 7. Scoring

- [ ] 7.1 Implement artifact parsing for scoring: wall event log, played transcript, session output. An absent or unreadable artifact yields "unmeasured, with reason" for the dimensions that depend on it. [REQ: A score is computed from the run's own artifacts]
- [ ] 7.2 Implement the mechanical dimensions as pure functions: reaction latency, draw latency, prediction staged-vs-promoted, coverage of planted moments, unmatched reactions, filler share. [REQ: The scorecard measures reaction, drawing, judgement, and noise]
- [ ] 7.3 Unit-test every mechanical dimension, including a miss, an unmatched reaction, and an expired prediction. [REQ: The scorecard measures reaction, drawing, judgement, and noise]
- [ ] 7.4 Implement the judged dimensions via a judging agent; record verdict and reasoning, and mark each dimension computed-or-judged on the scorecard. [REQ: Mechanical and judged dimensions are separated]
- [ ] 7.5 Implement the speed validity rule: a non-real-time run reports latency dimensions as invalid rather than as numbers. [REQ: A run may only report figures its playback speed supports]
- [ ] 7.6 Implement scorecard comparison: improved / regressed / unchanged per dimension; refuse a latency comparison across mismatched speeds; refuse any verdict across mismatched scenario fingerprints. [REQ: Two runs of one scenario are comparable] [REQ: A run may only report figures its playback speed supports]
- [ ] 7.7 Unit-test the comparison, including both refusal paths. [REQ: Two runs of one scenario are comparable]
- [ ] 7.8 Register `replay score` (and the comparison) in the CLI with `--help`. [REQ: A score is computed from the run's own artifacts]

## 8. Baseline and documentation

- [ ] 8.1 Record the first baseline scorecard at real time, before any demo-driven copilot change lands. A baseline taken afterwards measures nothing. [REQ: Two runs of one scenario are comparable]
- [ ] 8.2 Record a second baseline under the headless runner so the interactive-vs-headless difference is a measured number rather than an assumption. [REQ: Two runs of one scenario are comparable]
- [ ] 8.3 Write the runbook: authoring a scenario, running a scored session, reading a scorecard, and comparing two. State explicitly that a replay does NOT exercise `transcript-writer` (design D1), so a passing scorecard is never read as "the transcript path is fine". [REQ: A score is computed from the run's own artifacts]
- [ ] 8.4 Update `CLAUDE.md` with the harness and the one property everything rests on: the consumer side is untouched, and any change to it invalidates the measurement.

## Acceptance Criteria (from spec scenarios)

- [ ] AC-1: A live copilot session polling a replayed runtime dir behaves as against a live capture, with no configuration or code difference. [REQ: A replay is indistinguishable from a live capture to its consumers, scenario: A polling consumer receives replayed lines as ordinary transcript lines]
- [ ] AC-2: While a replay runs the capture reads as alive; when it ends the consumer observes a normal capture end. [REQ: A replay is indistinguishable from a live capture to its consumers, scenario: The end of the scenario ends the capture]
- [ ] AC-3: At real time, the gap between two played lines matches the gap between their timestamps, and two-channel interleaving is preserved. [REQ: Playback is paced by the scenario's own timestamps, scenario: Two channels interleave as recorded]
- [ ] AC-4: A replay against a runtime dir with a live capture refuses to start and leaves the transcript untouched. [REQ: A replay never collides with a live capture, scenario: A live capture blocks a replay]
- [ ] AC-5: An unconsumed transcript in the target runtime dir is archived, never truncated. [REQ: A replay never collides with a live capture, scenario: An unconsumed transcript is not silently overwritten]
- [ ] AC-6: A scenario whose expectations contain no planted moments is rejected. [REQ: A scenario plants ground truth deliberately, scenario: A scenario without planted moments is rejected]
- [ ] AC-7: An operator can follow an entire scenario — time, section, speaker, text, planted moments — from the timeline alone. [REQ: The timeline is readable and matches the lines, scenario: An operator can read what will be played]
- [ ] AC-8: Editing a scenario's lines without regenerating its timeline is reported as stale. [REQ: The timeline is regenerated from the lines, scenario: The timeline is regenerated from the lines]
- [ ] AC-9: A scenario authored from unrelated source material plays and scores with no harness change. [REQ: A scenario is authored from any source material, scenario: A second scenario needs no code change]
- [ ] AC-10: A planted moment that draws no reaction is reported as a miss naming what was expected. [REQ: The scorecard measures reaction, drawing, judgement, and noise, scenario: A missed planted moment is counted]
- [ ] AC-11: A reaction matching no planted moment counts against precision rather than being ignored. [REQ: The scorecard measures reaction, drawing, judgement, and noise, scenario: A reaction with no planted moment behind it is counted separately]
- [ ] AC-12: A scorecard from a sped-up run reports its latency dimensions as invalid, and its content dimensions normally. [REQ: A run may only report figures its playback speed supports, scenario: A sped-up run reports no latency]
- [ ] AC-13: Comparing two scorecards of the same scenario version reports each dimension as improved, regressed, or unchanged. [REQ: Two runs of one scenario are comparable, scenario: A regression is visible]
- [ ] AC-14: Comparing scorecards across different scenario fingerprints refuses a verdict and says the measuring stick changed. [REQ: Two runs of one scenario are comparable, scenario: A scenario change invalidates the comparison]
- [ ] AC-15: A dimension whose evidence is missing is reported as unmeasured with a reason, and the rest still score. [REQ: A score is computed from the run's own artifacts, scenario: Missing evidence is reported, not guessed]
