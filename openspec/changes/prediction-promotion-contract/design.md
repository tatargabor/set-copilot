## Context

See proposal.md — Why. `promote` exists, is gated on a live registry, re-runs through
`ingest` so redaction applies, and is covered by tests. None of that changes here. What is
missing sits entirely on the producer's side of the boundary.

## Goals / Non-Goals

**Goals:**

- A producer that can promote, because it knows the command and what it has staged.
- No new state: the registry already exists and is authoritative.

**Non-Goals:**

- Automatic promotion. A prediction is a guess; the load-bearing invariant of this whole
  feature is that an unspoken guess never reaches a public client on its own. A rule that
  promotes without a human-or-conversation gate would undo the reason staging exists.
- A confidence score. There is no threshold, only the zone gate — deliberately, and this
  change must not smuggle one in through a "promote when sure" instruction.
- Changing expiry, zoning, or the promote gate.

## Decisions

### D1 — Ask, don't remember

The producer is a fork that runs, draws, and exits; the session that stages a prediction is
not necessarily the one that would promote it, and even within one session a prompt-held
list drifts. So the registry — which is already the authority for whether a promote is
allowed — becomes readable.

This is the same correction as the chat→wall mirror: a prompt mandate that measurably fell
behind became a mechanism. Here the mechanism already existed; only the ability to consult
it was missing.

### D2 — Read-only, and provably so

Asking must not defer expiry, broadcast anything, or resurrect a stale guess. A query that
quietly extended a prediction's life would make "expired" mean "expired unless someone
looked", which is the kind of rule nobody can reason about. The endpoint reads the map and
filters by the same clock the sweep uses.

### D3 — The contract teaches the rule, not just the syntax

Syntax alone would produce promotions on a timer, which is the failure mode staging exists
to prevent. So the contract states the trigger — *the conversation arrived at what the
prediction anticipated* — and states plainly that a guess expiring unused is a correct
outcome, not a miss. Otherwise a producer optimises for promoting rather than for guessing
well.

### D4 — Contract text is config, as the rest of it already is

`copilot.drawing.conventions` is data with defaults in `config.ts`. Adding the promotion
rule there keeps a project's ability to rename its categories or reshape what gets drawn
without forking the skill — the seam this repo keeps having to defend.

## Risks / Trade-offs

- **The producer may now promote too eagerly**, putting guesses on the public wall. → The
  gate is unchanged (only a live staged visual can be lifted, and redaction still runs),
  and `precision` is a scored dimension. A copilot that promotes noise will show up there.
- **One more call per draw cycle.** → Small, and only when the producer is about to decide
  about a promotion.
- **The list is a snapshot**, and a prediction can expire between reading and promoting. →
  The promote gate already refuses an expired visual, loudly. The list is advice; the gate
  is the authority.
