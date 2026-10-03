# session-skills Specification

## Purpose

Define the contract the shipped session skills (`ds`, `dd`, `dictate`, `meeting-copilot`) keep when a
Claude Code session drives set-copilot: which runtime directory every command runs against, how a
dictation is started, stopped and acted on, how a meeting copilot is started, kept alive and
stopped, and where the line runs between the mechanics a skill owns and the judgement a project
configures. The skills are prompts, so this spec states their observable behaviour, not their
wording.

## Requirements

### Requirement: Every skill command runs against one per-session runtime directory

Every set-copilot command a session skill issues — capture, stop, status, digest, prompt, path,
poll, wall, wall-emit, wall-stop, mirror-follow, doctor — SHALL be scoped to the runtime directory
`$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}`, written byte-identically in every command of
the skill, including the start and the stop of the same session.

The directory is how commands find each other: `stop` locates the capture through the PID file in
it, and the keyword index, transcript, poll offset and wall state all live there. A command scoped
differently from its partner silently talks past it — a `stop` outside the directory looks in the
global runtime dir and can kill another session's capture; a `digest` outside it leaves the
capture without a keyword index, so no line is ever topic-tagged. Scoping per Claude session (the
id is the conversation's own id) is what keeps parallel sessions from overwriting each other's
recording, and scoping under the project rather than the shared temp dir is what keeps a meeting
from being lost to a reboot or a second session from being refused outright. The `shared`
fallback applies only when the harness provides no session id.

#### Scenario: Dictation start and stop resolve the same directory

- **WHEN** `/ds` starts a capture and `/dd` later stops it in the same Claude session
- **THEN** both commands run with the identical `SET_COPILOT_DIR`, and `stop` finds that session's
  capture through the PID file in it

#### Scenario: Two parallel sessions do not collide

- **WHEN** two Claude sessions in the same project each start a dictation
- **THEN** each capture writes into its own `.set/copilot/<session-id>/` directory, and stopping one
  leaves the other recording

#### Scenario: Every meeting-copilot command shares the directory

- **WHEN** the meeting copilot runs digest, prompt, capture, wall, poll, wall-emit, status and stop
  over one session
- **THEN** each of those commands carries the same `SET_COPILOT_DIR` prefix

### Requirement: Dictation start and stop are each one tool call

`/ds` and `/dd` SHALL each complete in exactly one Bash call and SHALL NOT route through the
`dictate` skill; `/dictate start` and `/dictate stop` SHALL likewise be one call each. Start SHALL
run `capture --mic-only` with a recording limit taken from the optional minutes argument, defaulting
to **10** minutes, as a background command, then announce that dictation is active and end the
turn. Stop SHALL run `stop --print`.

Every extra tool call is a full model round-trip the user sits through while waiting to speak or
to be answered. The pieces that used to need their own calls are owned by the CLI: the capture
plays the rising tone itself when the microphone is live and stops itself at the limit, and `stop`
plays the falling tone and waits for the transcript flush, so the skill has no tone, timer or
status step to add.

#### Scenario: Default limit

- **WHEN** `/ds` is invoked with no argument
- **THEN** one background Bash call starts `capture --mic-only --max-minutes 10` and the turn ends
  after the "dictation active" message

#### Scenario: Explicit limit

- **WHEN** `/ds 3` is invoked
- **THEN** the capture is started with a 3-minute limit, still in a single call

#### Scenario: Stop is a single call

- **WHEN** `/dd` is invoked
- **THEN** one Bash call runs `stop --print`, with no separate status check, tone, or transcript read

### Requirement: The dictated output is the user's message, and tooling lines are not

The dictation stop path SHALL treat the text that `stop --print` emits as the user's own message
and act on it — answer, run, write code — without echoing it back, without cross-referencing it
against a knowledge base, and replying in the language it was dictated in. Any line beginning with
`[set-copilot]` SHALL be treated as the tooling talking, not the speaker, and SHALL NOT be acted on
as part of the message, regardless of which output stream it arrived on.

The prefix, not the stream, is the discriminator: `stop` reports `[set-copilot] Stopped capture
(pid …)` (or `No capture running`) on stdout ahead of the dictated text, while the dictation
hand-off command's output, a failure report, and a stitch fallback notice arrive on stderr. Either
way they share the terminal with the user's words, and a model that read them as dictation would act
on an instruction the user never spoke. The reassembly of the text itself, and the empty-dictation
report, are specified in `dictation-output`.

#### Scenario: A status line is not part of the message

- **WHEN** the stop output contains `[set-copilot] Stopped capture (pid 4242)` followed by the
  dictated sentence
- **THEN** the skill acts on the dictated sentence only

#### Scenario: A hand-off report is not part of the message

- **WHEN** a project hand-off command reports `[set-copilot] handover: saved to …` during a `/dd`
- **THEN** that line is ignored as tooling and the remaining text is acted on as the user's message

#### Scenario: The reply follows the dictated language

- **WHEN** the dictated message is in Hungarian
- **THEN** the session acts on it and replies in Hungarian, without restating what was said

### Requirement: The meeting copilot starts in one uninterrupted sequence

`/meeting-copilot start` SHALL execute its start phases in order, inline, without pausing for user
input between them: scope the runtime directory (phase 0), pre-load knowledge and load the policy
(phase 1), start the capture (phase 2), start the wall when asked (phase 2b), and arm the poll
Monitor (phase 3) — then announce that the copilot is active and end the turn. From then on the
Monitor's notifications drive the session: continuous analysis (phase 4) and, when a wall is
running, emitting to it (phase 5) happen per notification, not as further start steps.

A start that stops halfway for confirmation leaves a capture recording that nobody reads, or a
Monitor watching a capture that was never started.

#### Scenario: Start ends with an armed Monitor

- **WHEN** `/meeting-copilot start` is invoked
- **THEN** the digest, policy, capture and Monitor are all set up within the same turn, and the turn
  ends with the "copilot active" message rather than a question

### Requirement: Three knowledge modes, with the policy loaded in every one

The meeting copilot SHALL offer three knowledge modes: the default (regenerate the digest, read it,
and look up the configured knowledge sources on demand during the meeting), `--lite` (load the
enriched knowledge context once and use **no** tools during the meeting), and `--zero` (skip the
knowledge pre-load entirely and work from what is already in the conversation). In every mode,
including `--zero`, the session SHALL load the rendered policy (`set-copilot prompt`) before the
capture starts.

The modes trade precision against latency — a lookup costs seconds while the conversation moves on
— which is a per-meeting choice. The policy is not knowledge but configuration: it decides what the
copilot may speak up about, so skipping it would leave a `--zero` session running a taxonomy nobody
configured.

#### Scenario: Lite mode makes no lookups during the meeting

- **WHEN** the copilot was started with `--lite` and a notification arrives
- **THEN** the reaction is written from the pre-loaded context, with no Grep/Read call

#### Scenario: Zero mode still loads the policy

- **WHEN** the copilot is started with `--zero`
- **THEN** no digest is generated or read, but `set-copilot prompt` is still run before the capture

### Requirement: Mechanics live in the skill, judgement in the rendered policy

The meeting-copilot skill SHALL own only mechanics — the phase order, the commands, the poll loop,
the event shapes, the stop sequence. What is worth saying SHALL come from the rendered policy
(`set-copilot prompt`): the alert categories and their triggers, how much to talk (engagement), the
narration substance, the mirroring rules, and the drawing contract (categories, payload shapes, and
when a visual is warranted). The skill SHALL NOT substitute a taxonomy, silence policy, or drawing
convention of its own; where the skill names a default (the out-of-the-box alert categories, for
instance) and the rendered policy differs, the policy SHALL govern.

A project changes what its copilot judges by editing config, never by forking the shared skill — a
forked skill drifts silently from the one the package ships. Keeping the drawing contract in the
policy also means a drawing fork inherits it from the base context instead of having it restated in
every mandate (`fork-producer`).

#### Scenario: Alerts follow the configured categories

- **WHEN** a project's config renames or drops one of the default alert categories
- **THEN** the session raises alerts only in the categories the rendered policy lists, with no skill
  edit

#### Scenario: Talkativeness follows the engagement setting

- **WHEN** the rendered policy sets the engagement level to `reactive`
- **THEN** the session speaks only when a category fires, rather than applying a silence policy of
  its own

### Requirement: The capture and the wall outlive the tool call that starts them

The meeting copilot SHALL start the capture and the wall with `--detach`, each as an ordinary
(foreground) Bash call, and SHALL NOT start either as a background command. The capture SHALL be
started with a 240-minute limit. The wall SHALL be started in the session's runtime directory with
the fake feed off, on a port derived from the session id (`4180 + cksum(session id) mod 800`), and
the session SHALL read the bound URL back from the runtime directory rather than assume the derived
port. If a detached start fails, the session SHALL report the start-up log tail the command printed
instead of retrying blindly.

A background command is killed at the harness's time limit. Measured on a real call: the first
capture died after 30 minutes, the restarted one at exactly two hours, mid-sentence, the wall with
it, and nothing reported it until the transcript ran out. A detached process is not the tool call's
child; it lives until `stop` / `wall-stop` find it by its PID file, or until its own limit. The
per-session port keeps parallel sessions from fighting over one wall port, and the wall may still
fall back to another, which is why the URL is read back.

#### Scenario: A long meeting survives the harness limit

- **WHEN** a meeting runs past two hours
- **THEN** the capture keeps recording, because it was started detached and is not a child of any
  tool call

#### Scenario: A failed start is reported, not retried

- **WHEN** the detached capture exits during start-up
- **THEN** the session reports the log tail the command printed and does not silently start it again

### Requirement: The poll Monitor is re-armed while the capture lives

The meeting copilot SHALL consume the transcript through a persistent Monitor wrapping
`set-copilot poll` in a loop that prints only non-empty batches and exits on `capture-dead`, rather
than tailing the file or polling in a blocking foreground loop. When the Monitor ends without a
`capture-dead`, the session SHALL check `set-copilot status` and, if the capture is still running,
start the same Monitor again at once, without asking the user. The poll's own semantics are
specified in `transcript-poll`.

The harness can end a Monitor at its own time limit while the detached capture keeps recording;
left alone, the transcript grows and nobody reads it. Re-arming loses nothing, because the poll
offset lives in the runtime directory and the next batch picks up where the last one stopped.

#### Scenario: Monitor ends at the harness limit mid-meeting

- **WHEN** the Monitor stream ends and `status` reports the capture still running
- **THEN** the session starts the same Monitor again immediately, and the next batch contains the
  lines said in between

#### Scenario: Capture ended

- **WHEN** a batch contains `{"type":"capture-dead"}`
- **THEN** the Monitor exits and the session processes the remaining lines and gives its closing
  summary, without re-arming

### Requirement: A batch is answered without filler, acting on events rather than lines

Each Monitor notification SHALL be answered as ordinary chat text, and a batch that gives the
copilot nothing to add SHALL produce no visible text at all. A `reconnect` event with a large gap
SHALL be reported as possibly-missing speech rather than guessed over. A `wall-input` event SHALL be
acted on as a direct instruction at command priority, as the event, never on a transcript line that
resembles it (`wall-input`). Chat is the primary voice whenever a wall is also running (`wall-feedback`).

A "listening" or "waiting" line costs the operator attention for nothing and, mirrored onto a wall,
puts noise in front of an audience. Acting on the event rather than the line is what keeps one
instruction from being carried out twice: a transcript line that sounds like a typed wall message
may be someone reading it aloud or quoting it back.

#### Scenario: Nothing to add

- **WHEN** a batch contains only greetings and scheduling talk that fit no alert category
- **THEN** the turn ends with no visible text

#### Scenario: A reconnect gap is named

- **WHEN** a batch contains a `reconnect` event with a large `downtime_ms`
- **THEN** the reaction says the surrounding text may be incomplete instead of completing a
  half-sentence

### Requirement: The `wall` and `mirror` options make the session own its wall

Adding the word `wall` to the start arguments (combinable with any knowledge mode) SHALL make the
session start the wall itself, in the same runtime directory as the capture, and tear it down at
stop; without it no wall is started and wall emitting is skipped. Adding `mirror` alongside `wall`
SHALL turn on chat mirroring for the session: the session SHALL start the transcript follower as a
background command, then gate on `doctor --mirror`, and only on success create the opt-in marker;
it SHALL render the policy with `COPILOT_MIRROR=1`. On a failed gate it SHALL report the command's
own message and state that mirroring is off, and continue the session. The session SHALL NOT emit
the mirror itself. The delivery and gating guarantees are specified in `chat-mirror` and
`mirror-follower`.

A wall hand-started in another terminal against another directory is the split that makes drawings
and transcript point at different places. Starting the follower before writing the marker is what
keeps the session's earlier messages off the wall, and emitting the mirror by hand next to the
follower would double every line.

#### Scenario: Wall and capture share a directory

- **WHEN** the copilot is started with `start --lite wall`
- **THEN** the wall is started detached in the same `SET_COPILOT_DIR` as the capture, and its URL is
  reported to the user

#### Scenario: Mirror gate fails

- **WHEN** the copilot is started with `start wall mirror` and `doctor --mirror` exits non-zero
- **THEN** no opt-in marker is written, the CLI's own message is reported, and the session states
  mirroring is not enabled while the rest of the session proceeds

### Requirement: The meeting stop writes the summary first, then stops capture and wall

`/meeting-copilot stop` SHALL, when mirroring is on, write the closing summary in its own turn before
stopping anything. It SHALL then run `stop` followed by `wall-stop` in the session's runtime
directory, without `--print`, passing the meeting's topic as `COPILOT_HANDOVER_SLUG` on the stop line
when the project's hand-off command wants one. If either command reports a pending mirror message it
could not deliver, or a failed project hand-off, the session SHALL say so rather than reporting a
clean stop. What the stop's closing report contains is specified in `meeting-transcript-persistence`.

The stop path drains the mirror before tearing the wall down (`mirror-follower`), but a summary
written after the wall is gone has nothing left to reach — the one ordering no mechanism can fix,
which is how a session's most valuable message once never appeared on the wall. The topic slug comes
from the session because only the session knows what the meeting was about. `wall-stop` only ever
stops the wall in this runtime directory, so it is safe to run when no wall was started.

#### Scenario: Summary precedes stop with mirroring on

- **WHEN** `/meeting-copilot stop` is invoked in a session started with `wall mirror`
- **THEN** the closing summary is written before `stop` and `wall-stop` run, and it reaches the wall

#### Scenario: Undelivered message is reported

- **WHEN** `stop` reports a mirror message it could not deliver
- **THEN** the session tells the user so instead of reporting a clean stop
