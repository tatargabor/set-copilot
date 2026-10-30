# Design

## Context

Retro-spec: the behaviour already ships (see proposal.md — Why). The work is reading the code and
its history (`43d58d6`, `aadaea9`, `6935dc9`, `66df2d7`, `2835e5d`) and writing down what it
does, with the measured reason each rule exists. No source file changes.

## Goals / Non-Goals

**Goals:**
- Every requirement is checkable against a named file and line (tasks.md).
- Where an existing spec contradicts the code, the spec moves to the code, with every base
  scenario carried forward.

**Non-Goals:**
- Fixing anything found along the way. Gaps are recorded below as open questions for a later,
  forward-looking change.
- The capture pipeline (audio, Soniox clients, reconnect mechanics), the wall-input seam of
  `poll`, and the knowledge index build — those belong to other capabilities.

## Decisions

- **Two new capabilities, not one.** The line format (`live-transcript-format`) and the fast lane
  (`fast-lane-commands`) share a writer but have different consumers and different reasons to
  change: the format is read by `poll`, the stitch and the copilot; the lane is a command channel
  with its own vocabulary, caps and policy text.
- **`transcript-poll`: MODIFY the offset requirement rather than add beside it.** The base text
  said the offset advances "only for lines it returned"; the code advances past every line read,
  including filtered echoes. Adding a second requirement would leave a contradiction in the spec.
- **`transcript-stitch`: one ADDED fallback requirement, plus one-sentence exceptions in the
  ordering and overlap requirements.** The fallback overrides both, and a reader of either must
  not find an unqualified SHALL that the code breaks.
- **Census corrections are applied, not just noted** (see the report): the Unicode-boundary claim
  is scoped to names, keyword stems and the fast-lane fold, because the English `detect.*`
  defaults use `\b`; the fast lane is specified as accepting either channel, because the code and
  its tests do.

## Risks / Trade-offs

- [The spec enshrines behaviour that may be unintended] → Recorded as open questions; a forward
  change can MODIFY the requirement deliberately.
- [Line numbers in tasks.md drift as the code moves] → They are evidence at the time of writing,
  not a contract; the requirement text is the contract.

## Open Questions

- The fast lane accepts commands from the `system` channel, while `command:true` deliberately
  does not. Tests assert the former as intended ("the marker is explicit"); whether a remote
  participant should be able to drive the copilot is a product decision.
- The timeout cap is evaluated only when the speaker's next speech arrives (or at capture close),
  not by a timer, so a speaker who opens a command and falls silent produces no abandonment
  until they speak again.
- A marker is matched against the accumulated buffer as soon as a token ends, so a closing word
  that is a prefix of a longer word split across tokens (`stop` | `ped`) can close a command one
  token early.
- `fast-lane.ts` documents "a second opener restarts it", but the code and its test treat a
  second opener as part of the instruction; the comment is stale.
- The stitch statistics count clock restarts internally but `--stats` prints only whether a
  rotation was repaired, not the restart count.
