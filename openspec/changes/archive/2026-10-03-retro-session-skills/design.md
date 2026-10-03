# Design

## Context

Retro-spec: see proposal.md — Why. The skills are prompts, so their "implementation" is the text in
`skills/*/SKILL.md` plus the CLI behaviour it relies on (`src/cli.ts` stop path, `src/detach.ts`,
`src/handover.ts`). Several neighbouring capabilities already specify parts of what the skills do.

## Goals / Non-Goals

**Goals:**
- Specify the observable contract a session skill keeps, verifiable against the skill text and the
  CLI it calls.
- Keep the new requirements disjoint from existing specs and from the active
  `dictation-stitched-output` change.

**Non-Goals:**
- Changing any skill, source, or config file — including where the census found the skill text
  imprecise (see Risks).
- Specifying `transcript-recover` and `set-repair` (covered by `transcript-recovery` and
  `runtime-repair`), or the policy renderer's content (`set-copilot prompt`).

## Decisions

- **Contract, not wording.** Requirements name commands, arguments, ordering and outcomes; they do
  not quote prompt prose. Alternative — quoting the skill — would make every rewording a spec change.
- **Reference instead of restating.** Poll semantics, mirror delivery and gating, fork drawing,
  pending markers, staging, narration, wall input and the meeting stop's artifacts each already have
  a spec; the session-skills requirements state only the skill-side obligation and name the spec.
- **ADDED-only on `meeting-transcript-persistence`.** The dictation hand-off is two new requirements
  with names that `dictation-stitched-output` does not touch, so that change's MODIFIED requirement
  archives cleanly whichever order the two land in.
- **The prefix, not the stream, marks tooling output.** The `dd` skill says `[set-copilot]` lines
  arrive on stderr, but `stop` prints `Stopped capture (pid …)` / `No capture running` on stdout
  (`src/cli.ts:744,763`). The spec states the behaviour that holds on both streams: a prefixed line
  is tooling.

## Risks / Trade-offs

- [The `dd` skill's "they arrive on stderr" is inaccurate for stop's status lines] → recorded here
  and in the spec's WHY; correcting the skill text is a follow-up change, not part of a retro-spec.
- [The mirror follower is started as a background command, which the capture's own history shows
  the harness can kill at its time limit] → stated as current behaviour; whether the follower should
  also detach is a decision for a future change.
- [The `wall-input` rule is stated both in the skill and in the rendered policy] → the spec records
  that the policy governs on any disagreement, rather than claiming the skill never restates policy.
