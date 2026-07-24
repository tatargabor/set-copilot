## Context

This change is the slim remainder of the former `wall-feedback-and-replay`, after two reductions:

- The **`wall-feedback`** capability (chat-primary feedback, `copilot.acknowledge`,
  ambiguity-as-chat-question) already shipped and was **split out and archived** as its own applied
  spec (`openspec/specs/wall-feedback`). It is not part of this change.
- The former "server rebuilds accumulated state from the JSONL log on startup" requirement was
  **redundant** with the applied `wall-server` spec ("State replay on connect" + "Events file is
  canonical on restart"), which the shipped `jsonlTailSource.drain()` already satisfies for graphs
  and pinned latest. It is dropped as a standalone requirement; only its genuinely-new part —
  scroll-history surviving a restart — is folded into the scroll-history requirement here.

What remains is one real unbuilt feature (scroll-history replay) plus a small operational safety
requirement (a safe log reset). The verification/latency/docs debts (former tasks 4–6) are not
spec-driven-change material; they moved to `docs/ROADMAP.md` #6.

## Goals / Non-Goals

**Goals:**
- **State-replay completeness for scroll lanes:** a late-joining or reloading window sees the recent
  scroll lines (e.g. súgás), not a blank lane, and those lines survive a log-preserving restart.
- **Safe log reset:** a fresh run rotates `wall-events.jsonl` aside rather than truncating a live one.

**Non-Goals:**
- The chat↔wall feedback contract (shipped, now `wall-feedback`).
- Restating the graphs/pinned-latest rebuild (already in `wall-server`).
- New render types, categories, or director changes.
- The browser-verification gate and live latency measurement (ROADMAP debts, not this change).

## Decisions

### D1 — Scroll-history is a fixed-size ring per scroll category, replayed zone-filtered

The server keeps a fixed-size ring (N per category, default 20) for each `scroll`-behavior category.
On connect, `replay()` sends the last N lines per scroll category **in addition to** the graphs and
pinned latest it already replays, zone-filtered exactly like the live stream.
**Why:** the unresolved `monitor-wall-display` Open Question silently defaulted to "no scroll-history
replay", so a reconnecting private window saw a blank súgás lane.
**Alternative (rejected):** unbounded history — grows without bound; a fixed N bounds memory.

### D2 — The scroll ring is rebuilt from the canonical log, reusing the existing once-only guarantee

The scroll ring is part of the accumulated state the server rebuilds from `wall-events.jsonl` at
startup — the same drain path that already rebuilds graphs and pinned latest (`wall-server`). It
reuses the shared line-offset so a line is never applied to the ring twice across the rebuild and the
live tail.
**Why:** the file is the canonical log; the scroll lanes should survive a log-preserving restart just
like the rest of the state. This is not a new rebuild mechanism, only an additional accumulated field.

### D3 — Safe reset: rotate the log aside, never truncate a live one

`wall --reset` renames `wall-events.jsonl` aside with a timestamp (preserved, not truncated) and
starts a fresh log, mirroring the transcript hand-over invariant. During live use the log is never
truncated in place.
**Why:** the accumulated state and its rebuild source must never be silently lost; the transcript
invariant already models the safe pattern.

## Risks / Trade-offs

- **[Scroll-ring memory]** Unbounded history would grow. → *Mitigation:* fixed N per category.
- **[JSONL rebuild cost on a large log]** → *Mitigation:* the rebuild only computes accumulated state
  (no broadcast); the scroll ring is capped at N, graphs at the shown visual.

## Open Questions

- **N default** — 20 per category is the proposal; confirm against real hint volume during the
  browser-verification ROADMAP pass.
