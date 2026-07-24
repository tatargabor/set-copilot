# Tasks

Scope: scroll-history in the connect-time replay + safe log reset. The shipped `wall-feedback`
capability was split out and archived; the redundant graphs/latest-rebuild requirement was dropped
(already in `wall-server`); the browser-verification / latency / docs debts moved to ROADMAP #6.

## 1. Scroll-history replay

- [ ] 1.1 `server.ts`: keep a fixed-size scroll-history ring buffer per `scroll` category (N config,
  default 20 via `src/config.ts`)
- [ ] 1.2 Extend `replay()` to send the last N scroll lines per scroll category, zone-filtered like
  the live stream
- [ ] 1.3 Extend `accumulate()` to feed the ring, so the startup drain over `wall-events.jsonl`
  rebuilds the scroll-history too (reusing the existing shared-offset once-only guarantee)
- [ ] 1.4 Unit tests (pure logic): ring eviction at N, rebuild determinism (same log → same ring),
  no double-count across rebuild+tail, zone-filtering of replayed scroll lines

## 2. Safe log reset

- [ ] 2.1 `wall --reset`: rotate `wall-events.jsonl` aside (timestamped rename), never truncate a
  live one — mirror the transcript hand-over invariant
- [ ] 2.2 Document the operational rule: during live use do not truncate the log or restart
  mid-session; a fresh run uses a new runtime dir or this deliberate rotation

## 3. Moved to ROADMAP #6 (not this change)

- [x] 3.1 Browser-verification gate (reconnect/replay/render feel; closes `monitor-wall-display`
  7.3/7.4) and live latency measurement recorded as ROADMAP debts, not spec-driven-change tasks
