# Tasks

## 1. mirror-follower

- [x] 1.1 Verify the policy verdicts are emit/short/filler with chunking and the sidechain exclusion against src/mirror-policy.ts:78 and src/mirror-follow.ts:103 [REQ: Mirroring is delivered by a continuous transcript follower]
- [x] 1.2 Verify transcript resolution from --transcript, --session or the runtime dir basename against src/cli.ts:663 and src/mirror-follow.ts:149 [REQ: Mirroring is delivered by a continuous transcript follower]
- [x] 1.3 Verify init/reset positioning and gate-closed skipping against src/mirror-follow.ts:321 and src/mirror-follow.ts:345 [REQ: Delivery resumes from a durable offset and never replays history]
- [x] 1.4 Verify the log decision vocabulary and 2000-line rotation against src/mirror-follow.ts:59 and src/mirror-follow.ts:207 [REQ: The mirror records what it decided]
- [x] 1.5 Verify fencing applies only when codeBlocks is keep against src/mirror-policy.ts:84 [REQ: Monospace-dependent content is fenced by the sender, not by instruction]
- [x] 1.6 Verify init unregisters wall-mirror.sh and doctor --mirror warns against src/cli.ts:551 and src/diagnostics.ts:360 [REQ: A retired mirror hook registration is removed and reported]

## 2. live-narration, fork-producer, graph-worker

- [x] 2.1 Verify disabled narration renders no Narration section and enabled only appends against src/copilot-prompt.test.ts:475 [REQ: Verbosity is configurable and defaults louder than silent-reactive]
- [x] 2.2 Verify settled content is emitted without a fork against skills/meeting-copilot/SKILL.md:345 [REQ: The producer is a fork of the main session]
- [x] 2.3 Verify one fork per category against skills/meeting-copilot/SKILL.md:356 [REQ: One fork per slot mandate, parallelizable]
- [x] 2.4 Verify emittedAt is stamped by the append path against src/wall/emit.ts:392 [REQ: The emission seam is unchanged]
- [x] 2.5 Verify no standalone graph worker exists in src/ and the tombstone pointers resolve to the archived fork-wall-producer change [REQ: Graph production is a fork-producer responsibility]

## 3. predictive-staging

- [x] 3.1 Verify the ttl default, clock-decided promote gate, refresh on staged delta and private-only marker against src/config.ts:1279, src/wall/server.ts:559, src/wall/server.ts:607 and src/wall/server.ts:760 [REQ: An unused prediction expires quietly]
- [x] 3.2 Verify /api/staged shape and the wall-staged no-wall exit against src/wall/server.ts:594 and src/cli.ts:295 [REQ: What is currently promotable can be asked for]
- [x] 3.3 Verify staged:true on a non-private zone is rejected against src/wall/emit.ts:183 [REQ: A staged event on a non-private zone is rejected whole]
- [x] 3.4 Verify only a private graph with a visual id is registered against src/wall/server.ts:760 [REQ: Only an identified graph enters the promotable registry]

## 4. recovery-ledger, runtime-repair, transcript-replay

- [x] 4.1 Verify mark requires a JSON array and records its count, and the guard's three-block bound, against src/cli.ts:960 and hooks/recovery-guard.sh:68 [REQ: Recording a completed step SHALL NOT depend on the caller remembering]
- [x] 4.2 Verify the mirror.pid fault check against skills/set-repair/SKILL.md:71 [REQ: Runtime state faults are detected and reported]
- [x] 4.3 Verify scheduling from the run start against src/replay.ts:75 [REQ: Playback is paced by the scenario's own timestamps]
- [x] 4.4 Verify only the playable line is written against src/replay-scenario.ts:159 [REQ: Only the playable line reaches the transcript]
- [x] 4.5 Verify maxLatenessMs recording and the one-time warning against src/replay.ts:183 [REQ: The player records its own lateness]

## 5. wall-feed, wall-input, box-policy, text-formatting

- [x] 5.1 Verify the producer partition (forks, direct text lanes, mirror process) against skills/meeting-copilot/SKILL.md:345 and src/mirror-follow.ts:369 [REQ: Modality-partitioned parallel producers]
- [x] 5.2 Verify the client-side render-type dwell deferral against src/wall/public/wall.js:768 [REQ: Modality-partitioned parallel producers]
- [x] 5.3 Verify a transcript category is dropped at ingest and alerts are chat-only against src/wall/server.ts:745 and src/copilot-prompt.ts:324 [REQ: Text path carries no model hop]
- [x] 5.4 Verify fast-lane commands on any channel and mic-only name-addressing against src/transcript-writer.ts:211 and src/transcript-writer.ts:347 [REQ: Speaker and zone primitives preserved]
- [x] 5.5 Verify control lines are unstamped against src/wall/emit.ts:349 [REQ: Every appended event records when it was emitted]
- [x] 5.6 Verify hideInput removes the strip input against src/wall/public/wall.js:542 [REQ: The wall page can send a short message to the session]
- [x] 5.7 Verify the BoxPolicy keys against src/config.ts:276 [REQ: Policy is scopable to a box]
- [x] 5.8 Verify only overridden keys are rendered against src/copilot-prompt.ts:383 [REQ: The prompt renderer composes one section per box]
- [x] 5.9 Verify the shipped narration box and its policy against src/config.ts:640 [REQ: A public narration box narrates processed output]
- [x] 5.10 Verify policy is stripped from the bootstrap against src/wall/server.ts:75 [REQ: Box policy is never served to wall clients]
- [x] 5.11 Verify underscore-literal italics, heading shape and ragged rows against src/wall/public/text-format.mjs:27, src/wall/public/text-format.mjs:129 and src/wall/public/text-format.mjs:205 [REQ: The inline formatting vocabulary is closed]

## 6. wall-server, wall-liveness, wall-scroll-replay, wall-pending-indicator

- [x] 6.1 Verify startup output and the loopback bind against src/wall/index.ts:177 and src/wall/server.ts:383 [REQ: Wall command serves a local display]
- [x] 6.2 Verify routing by zone and box subscription against src/wall/server.ts:884 [REQ: Config-driven windows]
- [x] 6.3 Verify run-scoped ids and the full-replay announcement against src/wall/server.ts:288 and src/wall/server.ts:1327 [REQ: SSE broadcast transport]
- [x] 6.4 Verify graph replay over paced categories and the client rebuild on full replay against src/wall/server.ts:1014 and src/wall/public/wall.js:437 [REQ: State replay on connect]
- [x] 6.5 Verify the director handles graph-visual swaps and the client defers render-type swaps against src/wall/server.ts:766 and src/wall/public/wall.js:768 [REQ: Server-side playout director]
- [x] 6.6 Verify the producer example category exists in the default registry against src/config.ts:640 [REQ: Producer-agnostic event source]
- [x] 6.7 Verify fake-feed zone, default-on and in-process ingest against src/wall/feed-script.ts:9 and src/cli.ts:283 [REQ: Scripted fake-feed mode]
- [x] 6.8 Verify the heartbeat source, interval and first beat against src/wall/server.ts:442, src/wall/server.ts:1152 and src/wall/server.ts:1055 [REQ: The liveness signal is broadcast on a timer, not on transcript events]
- [x] 6.9 Verify the 4x disconnect rule, quiet threshold and heartbeatMs 0 against src/wall/public/wall-core.mjs:246, src/wall/public/wall.js:460 and src/wall/public/wall.js:623 [REQ: The client judges transport liveness from the absence of the signal]
- [x] 6.10 Verify no per-box arrival indicator exists and the log records emissions against src/wall/public/wall.js:806 [REQ: A terminal message SHALL NOT wedge a lane]
- [x] 6.11 Verify only --reset rotates after the live check against src/wall/index.ts:73 and src/wall/index.ts:132 [REQ: A fresh wall run rotates the log aside, never truncates a live one]
- [x] 6.12 Verify pending markers are not accumulated and full replay clears them against src/wall/server.ts:673 and src/wall/public/wall.js:446 [REQ: A pending marker is never replayed state]
