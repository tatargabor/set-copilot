## Context

The copilot answers into a terminal. Reading it aloud would free the operator's eyes at exactly the
moments they are scarcest — mid-meeting, while driving the wall, while dictating — but the answer
that reaches the terminal is written *for* the terminal: fenced code, file paths, aligned tables,
nine-item reports. Speaking that verbatim is worse than silence.

The obvious fix is a second model call to summarize for the ear. That is exactly what this design
refuses. The whole value of a spoken channel is that it is current; a fork on the speech path
(measured elsewhere in this repo at 16–62 s for a fork-based draw) makes it a channel that speaks
about the answer you already finished reading.

Two pieces of prior art in this repo carry most of the design:

- **`mirror-follow.ts`** — the chat→wall mirror. It replaced a `Stop` hook on 2026-07-29 after that
  hook proved to be permanently one message behind (late by construction, last-block-only, and
  racing the transcript's flush by 0.2 s). Its offset/PID/log discipline and its two exported pure
  helpers (`parseMirrorables`, `resolveTranscriptPath`) are directly reusable.
- **`mirror-policy.ts`** — one pure implementation of a content judgement, called in-process by the
  follower and wrapped by a CLI subcommand, precisely so no per-message process spawn lands on the
  latency path. `speak-policy.ts` is the same shape.

The machine fact that shapes the engine decision: `say -v '?'` on this machine lists `Tünde` (hu_HU).
The shipped engine can therefore be offline, keyless, and instant — for the language the operator
actually dictates in.

## Goals / Non-Goals

**Goals:**

- Speak the session's answers with no added model call and no network round-trip on the speech path.
- Reuse the mirror's follower discipline rather than inventing a second delivery mechanism.
- Make the spoken channel a strict, derived subset of the terminal channel — the terminal's content
  is unchanged and remains the detailed one.
- Make silence diagnosable. Speech fails identically to being switched off, so the log and `doctor`
  carry more weight here than they do on the wall.
- Keep engine, voice, rate and ceiling in config, so a cloud engine is a later change against an
  existing seam rather than a rewrite.

**Non-Goals:**

- No second model call anywhere on the speech path — not as a default, not as an option. An option
  would be selected in exactly the situation where latency matters most.
- No cloud engine, no Linux engine in this change.
- No spoken input; that is `/ds`.
- No change to what the terminal shows.
- No wall involvement. Speech is an operator channel; it does not emit wall events.

## Decisions

### D1 — A separate follower process, not a second sink inside `mirror-follow`

Speech gets its own process (`speak-follow`) with its own `speak.pid` / `speak-offset` /
`speak.log` / `speak.enabled`.

*Why not a second sink in the existing follower:* the two channels gate independently (voice on with
the wall down is the common case, and the reverse happens too), and independent gating means
independent offsets. A single follower with two offsets is the same code as two followers, minus the
ability to run, stop, and diagnose them separately — and plus a failure mode where one sink's error
stalls the other's offset.

*Cost accepted:* two processes tail the same file. At the mirror's 250 ms safety poll plus `fs.watch`
this is negligible, and it keeps each follower's ownership rules simple enough to state in one line.

### D2 — Two-tier selection: a model-written lead, then a mechanical fallback

Tier 1 is a short spoken lead the model writes at the top of its own message, behind a configured
marker. It costs roughly fifteen tokens inside a generation that was happening anyway — no extra
call, no extra round-trip, and the selection is made by the only participant that knows what the
message was *for*.

Tier 2 is a pure function: leading sentences to the ceiling, with fences, tables, paths and URLs
removed.

*Alternatives considered:*

- *Mechanical only.* Simpler, and the model needs to know nothing. Rejected as the primary tier
  because the first sentence of a technical answer is frequently the least speakable part of it
  ("Megnéztem a repót — a `mirror-follow.ts`..."). Kept as the fallback, where being merely adequate
  is the right bar.
- *A second model call (a small, fast model).* Rejected on the stated latency constraint. Also on
  cost shape: it turns every answer into two billed generations for a channel that is a convenience.
- *Asking the model for two full versions.* Rejected — it doubles the generation, which is the
  latency it was supposed to avoid.

*Where the lead convention lives:* rendered into `set-copilot prompt` from config, alongside
`copilot.alerts` and the drawing contract — not written into a skill. The repo's standing rule is
that a project must be able to rename or disable this without forking the skill. The mechanical
fallback is what makes the convention *optional*: a project that never adopts the marker still gets
usable speech, and a model that forgets it on one message is not silent for that message.

### D3 — A hard ceiling, deliberately unlike the mirror's chunking

`mirror-format.ts` divides a long message into consecutive wall events on block boundaries, because
a wall box accumulates and a reader scans. Speech truncates at a sentence boundary within the
ceiling and drops the rest.

This is the one place the speech path deliberately loses content, so it is worth being explicit
about why: a listener does not scan. The second utterance of a nine-item report arrives after the
first is forgotten and while the terminal already shows all nine. The remainder is not lost — it is
on screen, which is where a nine-item report belongs.

### D4 — Capture suppression is a required behavior, not a setting

While `capture.pid` in the same runtime dir names a live process, nothing is spoken.

Without it the feedback loop is immediate and silent: the speakers say the answer, the microphone
records the room, Soniox transcribes it, and `/dd` hands the session its own words as if the operator
had spoken them. There is no configuration under which that is wanted, so there is no configuration
for it.

*Alternative considered:* duck the speech, or rely on the OS's echo cancellation. Rejected — echo
cancellation is a property of the device chain (which this repo has already learned varies per
machine in ways that fail silently), and a half-cancelled utterance still reaches the transcript as
garbled text attributed to the operator. Holding is the only behavior that cannot be half-right.

Suppressed messages advance the offset rather than queueing, matching the mirror's gate: a burst of
answers spoken at the end of a dictation is noise, and the operator has read them by then.

### D5 — Barge-in cuts; it never queues

A newly speakable message stops the utterance in progress. A queue would make the channel drift
further behind with every message — the exact defect that got the `Stop` hook removed, reintroduced
by a different route.

### D6 — A cloud engine as the default, the local one as the fallback

`speech.engine` resolves to an engine object exposing `speak(text)` and `stop()`. This change ships
two: Google Cloud Text-to-Speech (default) and macOS `say` (fallback).

*Why the cloud engine is the default, against this design's own latency instinct:* it was decided by
a listening test, not by preference. The local Hungarian voice (`Tünde`) was judged inadequate, and
quality is not a nicety here — a spoken channel that is unpleasant to listen to does not get used, at
which point every other decision in this document is moot. Hungarian is the operator's working
language and the local voice is the only one macOS offers for it, so "configure a better local voice"
is not an available answer.

*The measurements that made this affordable, taken on 12 real messages from a live session:*

| Measured | Value |
| --- | --- |
| Spoken text per message (after tier-2 extraction) | **111 characters** average |
| Messages yielding a usable line | 11 of 12 (the 12th correctly below the floor) |
| Local speech rate (`say`, rate 175) | **~12.4 characters/second** |

At 111 characters and 100 spoken messages per day that is ~333k characters/month, against Chirp 3
HD's 1M characters/month free allowance — roughly 3× headroom, and $30 per additional million past
it. Cost is therefore not a deciding factor at this volume; it would take ~300 spoken messages a day
to reach the free tier's edge. The cheaper WaveNet/Neural2 tier ($16/M, same 1M free) is the
fallback-in-config if that ever changes.

*The same measurement resolves the ceiling*, which the first draft left open: at 12.4 chars/sec, 111
characters is ~9 seconds of speech. A 250-character ceiling would be a 20-second utterance — far past
what a "spoken lead" can be. **150 characters (~12 s) is the default ceiling.**

*Latency, honestly:* the cloud engine puts a network round-trip on the path this design was built to
keep short. Three things keep it tolerable and none of them is a model call: the utterances are small
(~111 chars, well inside one request), Chirp 3 HD offers a streaming endpoint that starts audio
before synthesis completes, and a content-hash cache makes a repeat free. A synthesis deadline bounds
the worst case — past it, the local engine speaks the line rather than the operator getting silence.

*Why the fallback is load-bearing rather than decoration:* the cloud engine has four failure modes
the local one does not (no credential, no network, an API error, a slow response). Falling back
degrades the voice; dropping the utterance would lose the content. The channel's whole premise is
that the terminal keeps everything, so speech may degrade — but a degraded utterance still carries
the information, and silence does not.

*Credentials:* environment or `.env` only, never committed config — the rule `SONIOX_API_KEY` already
follows in this repo, for the same reason. **Worth recording because it was the original assumption:**
a consumer Google One / Workspace subscription does not grant Cloud Text-to-Speech access; it needs a
Google Cloud project and an API key.

*Platform:* `say` is macOS-only, so on other platforms the fallback is absent and a cloud failure is
silence. `doctor` reports which engines resolved, so this is a stated limitation rather than a
mystery.

### D8 — Cloud speech means the answers leave the machine, and that is said out loud

Synthesizing in the cloud sends the copilot's answers to a third party. Those answers quote whatever
the session is working on — client material, code, configuration.

This design does not treat that as a blocker, because the operator can judge it per session and the
volume is small. It does treat it as something that must never be *implicit*: `speak on` names the
active engine and says the text is sent to it, and `doctor` reports local vs. remote. The local
engine stays a complete alternative — worse voice, nothing leaves the machine — rather than a
degraded mode you can only reach by breaking the cloud one.

This is deliberately weaker than `wall.redaction`'s fail-closed posture, and the difference is who is
exposed: the wall publishes to a room that did not consent, whereas this transmits the operator's own
session to a service the operator chose. Informed, not prevented.

### D7 — Delivery is confirmed before it is forgotten

The offset advances only after the engine has accepted the utterance; a failure leaves the offset and
retries next pass. This is the mirror's invariant, inherited verbatim, because it was learned the
expensive way: the hook stamped *before* emitting and emitted with `|| true`, making a failed
delivery both invisible and permanently de-duplicated.

The subtlety speech adds: an utterance can be *cut* (D5) after being accepted. A cut utterance counts
as delivered — it was spoken, and the listener has moved on to the message that replaced it. Retrying
it would speak a superseded answer, which is precisely what barge-in exists to prevent.

## Risks / Trade-offs

- **The model forgets the spoken-lead marker** → the mechanical fallback produces a usable line, and
  `speak.log` records which tier was used, so the convention's adoption is measurable rather than
  assumed.
- **A malformed or misplaced marker leaks into the terminal text** → the marker convention is a
  prefix line, matched anchored at the message start; a non-matching line is simply text. The
  terminal shows what the model wrote either way, so the worst case is a visible odd line, never a
  hidden one.
- **The `say` child outlives the follower** (crash, SIGKILL) → an utterance finishes speaking with no
  follower to stop it. Bounded by the ceiling to a few seconds; `set-repair` reports the orphaned
  `speak.pid`.
- **Barge-in cuts a message the operator wanted** → the full text is in the terminal, unchanged. This
  is the trade the whole design rests on: the spoken channel may lose, because the detailed channel
  never does.
- **Two followers on one transcript** → both are read-only over the file and each owns a distinct set
  of runtime-dir files; the only shared surface is the transcript itself, which neither writes.
- **Speech during a screen share or a meeting** → it is off by default and per runtime dir, so it is
  scoped to the session that turned it on. Not a redaction boundary and not claimed as one; this
  channel carries the operator's own answers to the operator's own speakers.

## Migration Plan

Additive: a new capability, new files, no existing behavior modified. Rollback is `speak off` (or
never running the follower); nothing else in the system changes shape when speech is absent. Config
gains a `speech` section with defaults that keep speech off, so no config migration is required —
this is a new optional section, not a changed meaning for an existing key.

## Open Questions

- **What is the marker for the spoken lead?** It must be visible-but-unobtrusive in the terminal,
  unlikely to occur naturally, and stable across languages. A leading `🔊` line and an HTML comment
  are the two candidates; the comment is invisible in the terminal but also invisible to the
  operator checking whether the convention fired. Defaulting to a visible marker, configurable.
- **The ceiling's default value.** Roughly 200–300 characters is one or two spoken sentences at a
  normal rate. Worth setting from one real session rather than from a guess.
- **Should `set-copilot stop` leave speech on?** `stop` ends the capture; the argument for keeping
  speech running is that the answer to what was just dictated is exactly the thing worth hearing.
  Leaning yes — the capture-suppression gate already handles the overlap, and turning speech off is
  a separate explicit action.
