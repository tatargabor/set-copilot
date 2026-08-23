## Why

Every copilot behaviour that matters — how fast it reacts, whether it draws the right
thing, whether it catches a contradiction, how much filler it emits — is today judged
by *recollection of a live meeting*. There is no way to answer "did that change make
the copilot better or worse?", because no two meetings are the same and none can be
run twice. A demo on 2026-08-24 forces the question: the wall is about to be developed
under time pressure, and without a repeatable measurement every improvement is a guess.

The seam to test through already exists and nobody has used it. The copilot never
talks to Soniox — it reads `<runtimeDir>/transcript.jsonl` through `set-copilot poll`.
So a *replay* of a scripted transcript exercises the real path end to end (poll, skill,
wall, mirror) with **zero engine change on the consumer side**. We are measuring the
production path, not a mock.

## What Changes

- **A new `set-copilot replay` subcommand** that appends a scenario's JSONL lines into
  the runtime dir's transcript, paced by the lines' own `ts` deltas, while holding
  `capture.pid` — so a live copilot session sees an ordinary, ongoing capture.
  `--speed` controls pacing; **1 (real time) is the default and is mandatory for any
  latency measurement**, because a model's thinking time does not scale with playback
  and a sped-up run flatters the copilot.
- **A scenario format**: a JSONL fixture in the transcript line shape (`speaker`
  mic/system, `ts`, `startTs`, `topics`, `urgency`, `question`) plus a sidecar file of
  **planted expectations** — the ground truth. A scenario deliberately contains
  audience questions on the `system` channel, direct copilot addresses, and planted
  traps (a self-contradiction against the source material, an open question, a
  decision).
- **A readable timeline** generated next to every scenario — when, on which slide, the
  presenter says what — and a live progress line during replay showing where the run
  currently stands. Operator requirement: the scenario must be *inspectable*, not an
  opaque blob.
- **A scorecard**: after a run, the wall event log and the session's own output are
  scored against the planted expectations — reaction latency, draw latency, prediction
  staged→promoted vs expired, alert precision/recall, filler ratio, and coverage of the
  moments the copilot should have reacted to. Mechanical metrics are computed; judgement
  metrics are scored by a judging agent. The scorecard records the `--speed` it ran at
  and marks latency figures from a sped-up run as invalid.
- **A documented headless runner**: `claude -p --allowedTools Bash` driving the poll
  loop. Measured working in this session (5 turns / 41 s over a file growing under it),
  with one documented difference from an interactive session — no `Monitor` tool, so the
  loop is a Bash loop.
- **Generation of scenarios is deck-agnostic.** The reference deck is the first
  fixture, not the interface; a scenario is authored from any source material and the
  harness never depends on that one deck.

## Capabilities

### New Capabilities
- `transcript-replay`: playing a scenario file into a runtime dir's transcript as if it
  were a live capture — pacing, speed control, PID ownership, progress reporting, and
  the refusal rules that keep it from colliding with a real capture.
- `replay-scenario`: the scenario's own shape — the JSONL line fixture, the planted
  expectations sidecar that carries ground truth, and the generated human-readable
  timeline.
- `replay-scorecard`: measuring one replay run against its scenario's expectations, and
  the validity rules that govern which figures a given run is allowed to report.

### Modified Capabilities
<!-- None. The consumer side (poll, skill, wall) is deliberately untouched: that is the
     property being relied on, and changing it would invalidate the measurement. -->

## Impact

- **New code**: `src/replay.ts` (player), `src/replay-scenario.ts` (scenario load +
  timeline render), `src/replay-score.ts` (scoring), wired into the CLI as `replay` and
  `replay score`. Pure logic unit-tested per this project's testing posture; the paced
  playback is verified by running it.
- **New fixture tree**: scenarios live under a versioned directory with their JSONL,
  expectations, and generated timeline. The first is authored from the reference deck.
- **Runtime dir**: `replay` becomes a second writer of `capture.pid` and the transcript,
  under the same "a second capture in the same runtime dir is refused" invariant that
  governs `capture`. It must never be able to write into a runtime dir owned by a live
  microphone capture.
- **No change** to `poll.ts`, the wall, the mirror, or the shipped skills. If a change
  to any of them turns out to be necessary to make replay work, that is a finding about
  a hidden coupling, and it is reported rather than papered over.
- **Docs**: a runbook for authoring a scenario and running a scored session.
