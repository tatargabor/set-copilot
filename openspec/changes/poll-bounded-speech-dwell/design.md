## Context

See proposal.md — Why. `pollDecision` is already a pure function over (liveness, lines,
offset), so this is one more condition in one place, and testable without timers.

## Goals / Non-Goals

**Goals:**

- Bound how long a spoken line can sit unseen during continuous speech.
- Leave every existing behaviour reachable, including exactly-as-before.

**Non-Goals:**

- Minimising latency. Every return is a model turn; the aim is a *bound*, not a race.
- Judging what is worth returning for. The poll stays mechanical — the model decides what
  matters, which is why the gate must not be clever.

## Decisions

### D1 — Count speech lines, not lines

A run of non-speech events is not something to react to, and counting them would fire the
poll on reconnect notices and silences — which already have their own trigger. Speech is
what a copilot answers to.

### D2 — A count, not a timer

A time-based dwell would fire during a genuinely quiet stretch, producing empty turns —
the "31% filler" failure this project already measured once, arriving by a different road.
A count fires only when there is something to show.

### D3 — Config, with zero meaning "as before"

The trade is cost against latency and it belongs to the operator, not to the engine. Zero
restoring the previous behaviour exactly means the change is reversible without a release,
and it makes the "unchanged" case a spec scenario rather than a claim.

The default is chosen to roughly halve the measured 30.7 s wait rather than to minimise it:
a lower bound buys less latency per additional turn than it costs.

## Risks / Trade-offs

- **More turns, more tokens.** → The point of D3: the operator sets it, and zero is free.
- **Shorter batches may read as less context per turn.** → A speech line is a complete
  sentence, and the copilot keeps its own conversation across turns; the batch is a
  delivery unit, not the whole context.
- **A regression would show as more filler**, if the copilot feels obliged to answer every
  batch. → `fillerShare` is a measured dimension with a band; this is exactly what it is for.
