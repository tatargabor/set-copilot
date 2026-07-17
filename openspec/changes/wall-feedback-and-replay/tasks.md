## 1. Chat↔wall feedback model (the missing concept)

- [x] 1.1 Update `meeting-copilot/SKILL.md` Phase 5: chat is the primary voice, the wall is the secondary artifact; when emitting a wall visual, also write a brief chat line stating what was understood (not raw transcript)
- [x] 1.2 Direct address is never met with silence: define the narrow feedback opening (direct address + acknowledging own wall emissions) without changing the multi-party category-firing policy
- [x] 1.3 Config seam for the acknowledgement amount: added `copilot.acknowledge` (boolean, default on), orthogonal to `engagement`; the mechanic stays in the skill, the amount in config. Rendered as a `## Feedback` block by `set-copilot prompt`
- [x] 1.4 Ambiguous interpretation is flagged in chat, not asserted on the wall (D2): the skill + the Feedback block instruct to state the assumption or ask before rendering guessed values

## 2. State-replay completeness

- [ ] 2.1 `server.ts`: keep a fixed-size scroll-history ring buffer per `scroll` category (N config, default 20)
- [ ] 2.2 Extend `replay()` to send the last N scroll lines per scroll category, zone-filtered like the live stream
- [ ] 2.3 Rebuild accumulated state (graphs, pinned latest, scroll-history) from `wall-events.jsonl` on startup — run `accumulate()` over the existing log before the live tail
- [ ] 2.4 Guarantee once-only application: the startup rebuild and the `jsonlTailSource` replay must not double-process the same line (shared offset / single accumulate path)
- [ ] 2.5 Unit tests (pure logic): scroll-ring-buffer eviction at N, rebuild determinism (same log → same accumulated state), no-double-count across rebuild+tail

## 3. Operational rule: don't reset the log / restart mid-session

- [ ] 3.1 Document the rule (D3 consequence): during live use, do not truncate `wall-events.jsonl` and do not restart the server mid-session; a fresh run uses a new runtime dir or a deliberate archive
- [ ] 3.2 Make a fresh run safe: a `wall --reset`/archive path that rotates the log aside (never silently truncates a live one), mirroring the transcript archive invariant

## 4. Browser verification gate (close the headless blind spot)

- [ ] 4.1 Write a short browser verification checklist (docs): reconnect via tab-reload shows correct state; a live chart update re-renders; paced-swap dwell/override feel; incremental graph append; zone filtering `/` vs `/wall`
- [ ] 4.2 Run the checklist with a human at a browser on a stable, non-restarted server; record pass/fail per item
- [ ] 4.3 Close `monitor-wall-display` tasks 7.3 (browser feel + state-replay on late-join) and 7.4 (A-path layout verdict) with the recorded result

## 5. Live latency measurement

- [ ] 5.1 Measure per-modality latency on a stable server: text (emit→render hop) and graph/chart (spec emit→render); record real numbers, not the research estimate
- [ ] 5.2 Record the main-session-on-hot-path cost of D9 (Opus emits): does emitting a compact spec alongside chat stay within the felt-live budget?

## 6. Docs & roadmap

- [ ] 6.1 Update `docs/ROADMAP.md` #6: record the chat↔wall model, the replay completeness, the browser gate, and the measured latency numbers
- [ ] 6.2 Record resolved open questions (scroll-history N, acknowledgement config field, rebuild/tail race) and the live-test retro that motivated this change
