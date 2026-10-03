## ADDED Requirements

### Requirement: A project command may run after a dictation handover

The dictation stop path (`stop --print`) SHALL support its own configured project command,
`copilot.dictationHandoverCommand`, run **after** the dictated text was emitted and the transcript
archived, and only when something was archived. It SHALL receive the archived transcript path as
`SET_COPILOT_TRANSCRIPT` and the runtime directory as `SET_COPILOT_DIR` through the environment, and
no derived-artifact paths, because a dictation produces none. It SHALL be a separate key from
`copilot.handoverCommand`: the meeting command SHALL NOT run on a dictation stop, and the dictation
command SHALL NOT run on a meeting stop. An absent or empty value SHALL run nothing; a value that is
not a string SHALL be ignored with a warning naming the key.

The command SHALL NOT be able to fail the handover: a non-zero exit, a missing executable, or
exceeding its 60-second limit SHALL be reported with the archived path, and the archive SHALL stay
intact — the same posture `copilot.handoverCommand` takes, because the rename is the invariant and
everything after it is a convenience.

Dictation transcripts land in the gitignored runtime directory, and lifting them into a project's
inputs was left to a later manual step. Measured in a consumer project: the lift script existed and
nothing called it, every saved dictation came from a hand-run, and the ones nobody ran it for were
simply gone — silently, because an inputs tree with no dictations in it looks exactly like a project
where nobody dictated.

#### Scenario: The command runs after print and archive

- **WHEN** a dictation stop runs with `copilot.dictationHandoverCommand` configured and a non-empty
  transcript
- **THEN** the dictated text is emitted, the transcript is archived, and only then is the command run
  with `SET_COPILOT_TRANSCRIPT` naming the archived file

#### Scenario: Nothing archived, nothing run

- **WHEN** a dictation stop finds no transcript, or an empty one
- **THEN** the command is not run

#### Scenario: The keys do not cross paths

- **WHEN** only `copilot.handoverCommand` is configured and a dictation stop runs
- **THEN** no project command runs on that stop

#### Scenario: A failing command does not lose the dictation

- **WHEN** the configured command exits with status 3
- **THEN** a report naming `copilot.dictationHandoverCommand`, the failure, and the intact archived
  path is emitted, and the transcript remains archived

### Requirement: The dictation hand-off never speaks inside the dictated message

The output of `copilot.dictationHandoverCommand` SHALL NOT reach the stream that carries the dictated
text. Its stdout and stderr SHALL be captured and re-emitted on stderr, one line at a time, each
non-blank line prefixed `[set-copilot] handover: `; its failure report SHALL likewise go to stderr
with the `[set-copilot]` prefix. This is the one behaviour in which it differs from
`copilot.handoverCommand`, whose output is inherited unchanged.

On the dictation path stdout is the channel the user's spoken words travel on, and whatever the
consumer reads there it reads as part of the user's instruction. A project script announcing where
it filed the transcript would splice a sentence the user never said into their own message — a
corruption with no recording to go back to. Re-emitting on stderr keeps the report visible to the
operator, and the prefix is what tells a reader, human or model, that the line is the tooling
talking.

#### Scenario: The command's stdout stays out of the message

- **WHEN** the configured command prints `saved to inputs/dictation/x.md` on stdout during a dictation
  stop
- **THEN** stdout carries only the dictated text, and stderr carries
  `[set-copilot] handover: saved to inputs/dictation/x.md`

#### Scenario: Blank lines are not forwarded

- **WHEN** the configured command prints blank lines among its output
- **THEN** only the non-blank lines are re-emitted, each with the prefix
