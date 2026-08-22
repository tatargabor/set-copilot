## Context

See proposal.md — Why. Two facts about the existing system shape everything below.

**The seam is already there.** The copilot's only input is `<runtimeDir>/transcript.jsonl`,
read through `set-copilot poll`, which tracks a line offset in `poll-offset` and checks
`capture.pid` for liveness. Nothing on that path knows or cares what wrote the file. So
the player is a *writer of that file*, not a new input mode, and the consumer side stays
byte-identical — which is the whole reason a replay measures anything real.

**Two invariants govern the runtime dir**, and a second writer must obey both: a second
capture in the same runtime dir is refused while one is live, and a transcript is handed
over exactly once (archived, never truncated). A replay that ignored either would orphan
a live recording or silently replay someone's meeting.

Measured this session: `claude -p --allowedTools Bash` sustains a multi-turn poll loop
over a file growing under it (5 turns / 41 s, new lines seen each turn). Headless is
viable; it has no `Monitor` tool, so the loop is a Bash loop.

## Goals / Non-Goals

**Goals:**

- One command plays a scenario; a live copilot session cannot tell it from a capture.
- A scenario is readable before it is run, and legible while it runs.
- A run produces a scorecard that answers "better or worse than last time".
- The harness outlives the first deck and the Monday demo.

**Non-Goals:**

- Realism of the *content*. A scenario is a fixture, not a prediction of what a real
  presenter would say. Its value is that it is identical every time.
- Scoring a live meeting. Without planted ground truth there is nothing to score against.
- Automating the whole loop in CI as part of this change. The pieces are built so that
  it could be, but a scored run costs a model session and that budget decision is the
  operator's.
- Any change to `poll`, the wall, the mirror, or the shipped skills.

## Decisions

### D1 — The player writes the transcript directly; it does not fake Soniox

**Chosen:** the player appends already-final scenario lines to the transcript file.

Alternatives considered: (a) a fake Soniox WebSocket server that `SonioxRtClient`
connects to; (b) a `sttBackend: "replay"` client emitting `TranscriptEvent`s through
`transcript-writer`.

Both replay *more* of the stack — and that is exactly the problem. They would put the
scenario through the flush rules (sentence boundary, 3 s silence, 80-token overflow),
so the lines the copilot sees would be the flusher's output, not the fixture's. The
measuring stick would then change whenever the flush logic changed, and a scenario could
not be compared across versions. Writing final lines keeps the fixture *authoritative*.

The cost is real and accepted: **the replay does not exercise `transcript-writer`.** That
code is covered by its own unit tests and by live use; the harness exists to measure the
copilot's judgement, not the flusher's. If a scenario ever needs to test flush behaviour,
that is a different fixture at a different layer, and option (b) is where it would go.

### D2 — Pacing is deadline-based, not sleep-accumulating

Each line's target wall-clock time is computed from the scenario's start, not by adding
sleeps. Sleep drift over a 40-minute scenario would silently stretch the run and corrupt
exactly the latency numbers the harness exists to produce. A late line is written
immediately and the lateness is recorded; if lateness exceeds a threshold the run reports
that the player itself fell behind, so a slow machine cannot masquerade as a slow copilot.

### D3 — `--speed` is metadata, not just a divisor

The divisor is trivial; the honest part is that it travels into the run record and makes
latency dimensions *invalid* rather than merely different (see the `replay-scorecard`
spec). Stated here because the tempting shortcut — "just note it in the filename" — is
what lets a fast run's flattering numbers get quoted later as if they were real.

### D4 — The player reuses the capture path's ownership rules, it does not re-implement them

PID acquisition, staleness reclaim, refusal against a live owner, and archive-don't-
truncate are extracted from `capture.ts` and shared, rather than written a second time
in `replay.ts`. Two implementations of "who owns this runtime dir" is precisely how the
first one gets a fix the second one never receives.

The PID file is `capture.pid` — the same name — because `poll`'s liveness check reads
that name. A separate `replay.pid` would require teaching `poll` about replay, which
violates the no-consumer-change property.

### D5 — Scoring reads artifacts; it never instruments the copilot

Evidence is `wall-events.jsonl` (what reached the wall, with timestamps), the played
transcript (what was said, with timestamps), and the session's own output. Nothing is
added to the copilot to make it observable, because an instrumented copilot is not the
copilot that ships. Corollary: a dimension is only measurable if it leaves a trace in
those artifacts — and where one does not, the spec's "unmeasured, with reason" branch
fires rather than a fabricated number.

### D6 — Mechanical scoring is pure and unit-tested; judged scoring is a subagent

Latency, promotion rate, filler share, and coverage counting are deterministic functions
over parsed artifacts — pure, in their own module, unit-tested, and the same on every
run. "Was this alert *right*?" is a judgement, delegated to a judging agent whose verdict
and reasoning are both recorded. Keeping them in separate modules is what stops a
non-deterministic judgement from quietly infecting a number that was supposed to be
comparable.

### D7 — The timeline is generated, never hand-written

It is rendered from the lines plus the expectations, so it cannot drift. A hand-written
timeline would be wrong the first time the scenario was edited, and an operator trusting
a stale timeline is worse off than one with none. A `--check` mode reports staleness.

The renderer is a third view over the scenario, alongside the player and the scorer —
deliberately not a second parse. The scenario is loaded once, by one loader.

### D8 — Scenario authoring is an agent task with a validated output, not a code generator

Turning source material into an imagined presentation is a judgement task; no parser
produces it. So authoring is a documented agent workflow whose *output* is validated
mechanically: line shape, monotonic timestamps, both channels present, and the planted
minimums the `replay-scenario` spec requires. The validator is the contract; the agent
is the author.

### D9 — Scenario storage is versioned by content, and the version is in the scorecard

A scenario carries a content fingerprint. Comparing two scorecards across different
fingerprints refuses a verdict. This mirrors the recovery ledger's reasoning: a path or
a filename is not an identity, and a comparison against a moved measuring stick is worse
than no comparison, because it looks like a result.

## Risks / Trade-offs

- **A scenario is only as good as its planted ground truth.** A weak scenario yields a
  flattering score, and nothing in the mechanism detects that. → The minimums are
  enforced by the validator, the timeline makes the scenario reviewable by a human before
  it becomes a baseline, and a scenario that stops discriminating between good and bad
  copilot behaviour is replaced rather than tuned.
- **Overfitting to the fixture.** Optimising the copilot against one scenario improves
  the score without improving the product. → More than one scenario, from unrelated
  source material; a score is evidence, not a target.
- **A real-time run costs real time and a model session.** A 40-minute scenario takes 40
  minutes and burns tokens. → Fast mode for content iteration; real time only when a
  latency claim is being made or a baseline is being set.
- **Headless differs from interactive** (no `Monitor`; the loop is a Bash loop). A score
  from a headless run therefore describes a slightly different copilot from the one an
  operator drives. → The runner mode is recorded in the run record, and the first
  baseline is taken both ways so the size of the difference is known rather than assumed.
- **The player is a second writer of the runtime dir.** A bug here can orphan a live
  capture or destroy an unconsumed transcript. → D4: shared ownership code, refuse on a
  live owner, archive rather than truncate. This is the highest-consequence part of the
  change and gets its tests first.
- **The replay does not cover `transcript-writer`** (D1). Accepted, and stated in the
  docs so a passing scorecard is never read as "the transcript path is fine".

## Migration Plan

Additive throughout — a new subcommand, a new fixture tree, new modules. Nothing existing
changes behaviour, so there is nothing to roll back beyond not invoking the new command.

Order of work: ownership and player first (highest consequence, and everything else needs
it), then the scenario loader and timeline, then the first scenario, then scoring. A
baseline is recorded before any copilot change lands for the demo — a baseline taken
afterwards measures nothing.

## Open Questions

- **How long should the first scenario be?** A full 40-minute run is the honest test; a
  10-minute one iterates far better. Both are the same format, so this is a fixture
  decision, deferrable until the first scenario is authored.
- **Where the scorecards accumulate** — alongside the scenario, or in the runtime dir.
  Affects no requirement and no task ordering.
