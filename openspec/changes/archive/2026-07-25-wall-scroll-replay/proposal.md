## Why

The state-replay a late-joining or reloading wall window gets is incomplete: it receives the current
graph state and pinned `latest` items, but **not** the recent `scroll`-category text — so a reloaded
private window shows a blank súgás lane. This is the unresolved `monitor-wall-display` Open Question
("only graph + pinned latest, or the last N scroll lines too?") that silently defaulted to "no
scroll-history replay". This change closes it and adds the safe log-reset that the replay's canonical
log depends on.

This is the slim remainder of the former `wall-feedback-and-replay`: the shipped `wall-feedback`
capability was split out and archived, and the redundant "rebuild graphs/latest from JSONL"
requirement (already in the applied `wall-server` spec) was dropped. The browser-verification, live
latency-measurement, and docs debts moved to `docs/ROADMAP.md` #6.

## What Changes

- **Scroll-history replay.** The server keeps a fixed-size ring (N per `scroll` category, default 20)
  and, on connect, replays the last N lines per scroll category alongside the graphs and pinned
  latest — zone-filtered like the live stream — so a reloading window is not blank.
- **Scroll ring survives restart.** The ring is part of the accumulated state rebuilt from the
  canonical `wall-events.jsonl` on startup, reusing the existing once-only (shared-offset) guarantee.
- **Safe log reset.** A `wall --reset` path rotates `wall-events.jsonl` aside (timestamped rename)
  rather than truncating a live one, mirroring the transcript hand-over invariant.

## Capabilities

### New Capabilities

- `wall-scroll-replay`: scroll-history in the connect-time replay (last N per scroll category,
  zone-filtered, rebuilt from the log on restart) and the safe log-rotation reset that protects the
  canonical log.

### Modified Capabilities

<!-- none — this ADDs onto the existing wall-server replay seam without changing its requirements -->

## Impact

- **Code:** `src/wall/server.ts` — a fixed-size scroll ring per scroll category next to `this.latest`;
  `replay()` extended to send the last N scroll lines; `accumulate()` extended to feed the ring (so the
  startup drain rebuilds it too). `src/cli.ts` / `src/wall/index.ts` — a `wall --reset` rotation path.
  `src/config.ts` — the scroll-history N (default 20).
- **Tests:** pure logic (vitest) — ring eviction at N, rebuild determinism, no double-count across
  rebuild+tail, zone-filtering of replayed scroll lines.
- **Not touched:** the audio → Soniox → transcript → poll chain; the category/box/zone model; the
  director pacing; the shipped graphs/pinned-latest replay.
- **Moved to ROADMAP (#6), not this change:** the browser-verification gate (closing
  `monitor-wall-display` 7.3/7.4) and the live latency measurement.
