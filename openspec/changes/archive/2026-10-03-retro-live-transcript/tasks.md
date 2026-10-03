# Tasks

Retro-spec: every task is a verification of behaviour that already ships. Line numbers are the
evidence at the time of writing (2026-10-03).

## 1. live-transcript-format

- [x] 1.1 Verify the sentence-boundary, own-silence (3 s) and overflow (>80 tokens) flush rules, final-only tokens, and the flush on close against src/transcript-writer.ts:190, src/transcript-writer.ts:240, src/transcript-writer.ts:250, src/transcript-writer.ts:272 and src/transcript-writer.ts:400 [REQ: A channel's speech is cut into lines by that channel's own rules]
- [x] 1.2 Verify no cross-channel flush exists (per-channel buffers only, no speaker-change hook) against src/transcript-writer.ts:102 and src/transcript-writer.ts:193, and the regression test in src/transcript-writer.test.ts:63 [REQ: A speaker change never flushes the other channel]
- [x] 1.3 Verify tokens are appended verbatim and the line text trimmed against src/transcript-writer.ts:220 and src/transcript-writer.ts:305 [REQ: Recognised tokens are concatenated, never space-joined]
- [x] 1.4 Verify `startTs` is recorded at the first token and written only when it differs from `ts` against src/transcript-writer.ts:200 and src/transcript-writer.ts:322 [REQ: A line records where its utterance began]
- [x] 1.5 Verify `partial` on silence/overflow flushes and `cont`/`midWord` captured from the resuming token's leading whitespace against src/transcript-writer.ts:203, src/transcript-writer.ts:308 and src/transcript-writer.ts:325 [REQ: A cut without a sentence boundary is marked, and so is how it resumes]
- [x] 1.6 Verify topic matching (Unicode word start, no word end, index order, decision ids last, omitted when empty, no matcher in dictation) against src/knowledge/keyword-matcher.ts:9, src/knowledge/keyword-matcher.ts:44, src/transcript-writer.ts:334 and src/capture.ts:156 [REQ: A meeting line carries the knowledge topics it mentions]
- [x] 1.7 Verify `urgency`/`question` flags, `iu` matching, defaults and wholesale replacement against src/transcript-writer.ts:338, src/config.ts:453 and src/config.ts:1262 [REQ: Urgency and question flags come from configured patterns]
- [x] 1.8 Verify an uncompilable pattern is dropped with a stderr warning and the rest kept against src/transcript-writer.ts:81 and src/transcript-writer.test.ts:180 [REQ: An invalid detection pattern is dropped, never fatal]
- [x] 1.9 Verify mic-only `command:true`, names merged with `detect.command`, escaping and suffix tolerance against src/transcript-writer.ts:347, src/config.ts:853 and src/config.ts:1266 [REQ: Naming the copilot on the mic channel marks the line as a command]
- [x] 1.10 Verify one silence event per period, gated on empty buffers and prior speech, against src/transcript-writer.ts:258 and src/transcript-writer.ts:371 [REQ: One silence event is written per silence period]
- [x] 1.11 Verify the `reconnect` event's fields and its placement in the transcript stream against src/capture.ts:51 and src/transcript-writer.ts:386 [REQ: A transcription reconnect is recorded in the stream]

## 2. fast-lane-commands

- [x] 2.1 Verify bracketed extraction (raw text between markers, opener-only produces nothing, both markers in one piece) against src/fast-lane.ts:128, src/fast-lane.ts:141 and src/fast-lane.ts:171 [REQ: A command is the speech between a start word and an end word]
- [x] 2.2 Verify the lane is fed tokens before any flush and keeps its own bounded per-speaker buffer against src/transcript-writer.ts:212 and src/fast-lane.ts:203 [REQ: The fast lane reads the token stream, not the written lines]
- [x] 2.3 Verify accent/case folding over Unicode letters and whole-word marker matching against src/fast-lane.ts:66 and src/fast-lane.ts:78 [REQ: Markers match whole words, accent- and case-insensitively]
- [x] 2.4 Verify per-channel spans, system-channel commands, and a second opener kept as text against src/fast-lane.ts:113 and src/fast-lane.test.ts:62, src/fast-lane.test.ts:101, src/fast-lane.test.ts:109 [REQ: Each channel has its own command span]
- [x] 2.5 Verify `too-long`/`timeout` abandonment evaluated on the next piece, close-time abandonment, and the return to watching against src/fast-lane.ts:147, src/fast-lane.ts:191 and src/transcript-writer.ts:404 [REQ: An unterminated command is abandoned out loud]
- [x] 2.6 Verify the `command` / `command-abandoned` JSONL shapes with `urgency:"high"` and that the ordinary line keeps the words against src/transcript-writer.ts:364 and src/transcript-writer.ts:220 [REQ: Fast-lane verdicts are written into the transcript stream]
- [x] 2.7 Verify `copilot.fastLane` resolution and defaults (enabled unless false, list and cap fallbacks, 45 s / 600 chars) against src/config.ts:708 and src/config.ts:1201 [REQ: The fast lane is configured under copilot.fastLane]
- [x] 2.8 Verify fast-lane events end the poll wait and bypass the echo dedup against src/poll.ts:43 and src/poll.ts:142 [REQ: A fast-lane event reaches the copilot at the next poll tick]
- [x] 2.9 Verify the policy section (configured words, event shapes, act-on-event, ahead of alerts, no partial execution, absent when disabled) against src/copilot-prompt.ts:91 and src/copilot-prompt.ts:340 [REQ: The copilot policy teaches the copilot to act on the event, not the line]

## 3. transcript-poll

- [x] 3.1 Verify the line-count offset advances past every line read, filtered ones included, against src/poll.ts:238 and src/poll.ts:243 [REQ: A poll returns the lines written since the consumer last read]
- [x] 3.2 Verify the early-return set (urgency, question, command flag, fast-lane events, silence with a speaker-attributed line) against src/poll.ts:125 and src/poll.ts:145 [REQ: A poll returns early on a line that should not wait]
- [x] 3.3 Verify event pass-through, empty-line drop, two-deep containment dedup and Unicode normalisation against src/poll.ts:20 and src/poll.ts:28, plus the noise-only dead case at src/poll.ts:122 [REQ: The batch is filtered of echoes and empty lines, never of events]
- [x] 3.4 Verify the 250 ms tick against src/poll.ts:193 [REQ: The poll checks for new lines every 250 ms]

## 4. transcript-stitch

- [x] 4.1 Verify recording-order sorting under the fallback and start-time sorting otherwise against src/transcript-build.ts:665 [REQ: Sentences are ordered by when they were spoken]
- [x] 4.2 Verify the per-channel repair, the one-minute threshold, speakerless rows not moving the timeline, and the first-restart break against src/transcript-build.ts:121 and src/transcript-build.ts:207 [REQ: A capture rotation is repaired onto a real timeline]
- [x] 4.3 Verify overlap marks are skipped and reconnect warnings kept under the fallback against src/transcript-build.ts:665 and src/transcript-build.ts:676 [REQ: Overlapping speech and connection losses are marked]
- [x] 4.4 Verify the fallback threshold (restarts > channels, min 1), steadiest-channel retiming, suppressed rotation marker and the "Timeline repaired" note against src/transcript-build.ts:652, src/transcript-build.ts:702 and src/transcript-build.ts:724, and the tests at src/transcript-build.test.ts:253 [REQ: Clocks that restarted more often than a rotation explains fall back to recording order]
