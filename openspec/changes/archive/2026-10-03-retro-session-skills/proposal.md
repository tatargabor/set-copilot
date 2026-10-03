# Proposal

## Why

This is a **retro-spec**. The session skills (`ds`, `dd`, `dictate`, `meeting-copilot`) and the
dictation hand-off seam were shaped by a run of ad hoc commits that never went through OpenSpec, so
today the skill files and `src/` are the only record of the contract a Claude Code session keeps
when it drives set-copilot. Writing that contract down — as it already is, not as it should be — is
what lets the next change to a skill be proposed against a spec instead of against a prompt file
that drifts silently.

## What Changes

Specs only. No source, skill, or config file changes.

- A new `session-skills` capability describing the observable contract of the shipped session
  skills: the per-session runtime directory and why it is byte-identical across every command, the
  one-call dictation fast path, how the dictated output is treated (and which lines are tooling),
  the meeting copilot's start sequence and knowledge modes, the `wall` / `mirror` options, the
  detached long-running processes, the re-armed poll Monitor, the stop ordering, and the split
  between mechanics (in the skill) and judgement (in the rendered policy).
- Two ADDED requirements on `meeting-transcript-persistence` for `copilot.dictationHandoverCommand`
  — the dictation-stop counterpart of `copilot.handoverCommand`, whose output never reaches the
  dictated text. They are deliberately ADDED, not MODIFIED: the active change
  `dictation-stitched-output` modifies that spec's existing handover requirement, and the two must
  not collide.

Behaviour already specified elsewhere is referenced, not restated: skill installation
(`skill-installation`), poll semantics (`transcript-poll`), the chat mirror (`chat-mirror`,
`mirror-follower`), fork drawing (`fork-producer`, `wall-pending-indicator`, `predictive-staging`),
narration (`live-narration`), wall input (`wall-input`), chat-primary feedback (`wall-feedback`),
the meeting stop's artifacts and `copilot.handoverCommand` (`meeting-transcript-persistence`), and
the dictated text's reassembly (`dictation-stitched-output`).

## Capabilities

### New Capabilities
- `session-skills`: the contract the shipped session skills keep when they drive set-copilot from a
  Claude Code session — runtime-dir scoping, dictation fast path and output handling, meeting
  copilot start/run/stop sequence, and the mechanics-vs-judgement split.

### Modified Capabilities
- `meeting-transcript-persistence`: ADDED requirements only — the dictation-stop project hand-off
  command, and the rule that its output is kept off the dictated message.

## Impact

None at runtime. Documentation of existing behaviour in `skills/{ds,dd,dictate,meeting-copilot}/SKILL.md`,
`src/handover.ts`, `src/cli.ts` (stop path), `src/config.ts` (`copilot.dictationHandoverCommand`),
and `src/detach.ts`.
