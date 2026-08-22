# P0 — capture goes deaf and nothing says so: no guard on an empty transcript

**Filed:** 2026-08-22, from a real dictation session in the `wpc-pont` consumer project.
**Cost of this instance:** 10 minutes of speech, unrecoverable — the capture streams, it
does not archive audio, so there is nothing to re-transcribe.

## What happened

```
[set-copilot] Starting capture (dictation)
[set-copilot] Mic: connected
[set-copilot] audio: mic=1849KB sys=0KB
[set-copilot] audio: mic=3697KB sys=0KB
… (nine reports, climbing)
[set-copilot] audio: mic=16826KB sys=0KB
[set-copilot] Max duration (10 min) reached — stopping
[set-copilot] Stopping...
[exited with code 0]
```

`dictation.jsonl`: **0 bytes**. Exit code 0. Not one `error`, `reconnecting`, `reconnected`
or `closed` line in the whole run.

The same command in the same session, 45 minutes earlier, worked (2166-byte transcript).

## What it is NOT — ruled out with evidence

| hypothesis | ruled out by |
|---|---|
| the mic was silent / `parec` broken | 16.8 MB captured; `doctor` reports `mic: 61 KB, peak=32767 — live signal` |
| `SONIOX_API_KEY` missing | `doctor`: `✓ SONIOX_API_KEY set` |
| a final flush was dropped on the auto-stop path | `transcript-writer.ts` uses `appendFileSync` per flush — a 0-byte file means **zero events ever arrived**, not a lost tail |
| stale runtime state (orphan PID, unconsumed transcript) | the `set-repair` sweep found none of its five faults; the runtime dir was clean |

## The actual gap

`soniox-rt.ts:44-56` already names this exact failure mode, from 2026-07-14:

> *"the capture did not crash, it went DEAF: `status` said 'running', the byte counters kept
> climbing, and no transcript line ever appeared again."*

Two defences were built for it, and **both watch the channel, not the result**:

| defence | question it asks | why it stayed silent here |
|---|---|---|
| reconnect with backoff | did the socket close? | it did not |
| ping/pong force-reconnect | is it half-open? | it never reported one |
| **missing** | **is any text coming back while audio flows?** | nothing asks this |

`capture.ts:219` has a guard for a **silent mic** — `0 bytes after 5s` — but no counterpart
for a **silent transcript**. So a dead input is loud and a dead transcription is mute, which
is backwards: the first is obvious to the user anyway, the second is invisible.

## Asked for

1. **A result-side guard in `capture.ts`.** Track transcript-event count next to `micBytes`.
   If audio has flowed past a threshold (~60s worth) and the event count is still **0**,
   print a loud warning **and force a reconnect** — a socket that has consumed a minute of
   speech without returning a word is dead regardless of what it reports about itself.
2. **A staleness variant of the same guard.** After the first event, if no new event arrives
   for N minutes while audio keeps flowing, treat it the same way. The run above would have
   been caught at ~1 minute instead of losing all ten.
3. **Make the failure visible in the artifact, not only on stdout.** The reconnect path
   already writes `{"type":"reconnect"}` into the transcript so a reader knows a gap
   happened (`capture.ts:44-52`). A deaf stretch deserves the same honesty — but note the
   degenerate case this instance hit: with **zero** events the file is empty, so there is no
   line to carry the warning. A 0-byte transcript and "the user said nothing" are
   indistinguishable to every downstream consumer. Consider writing the run's header/footer
   unconditionally so an empty transcript can still state *why* it is empty.

## Acceptance

- [ ] A test that fails before the fix: feed a client that connects, accepts audio, and never
      emits a transcript event; assert the guard fires within the threshold.
- [ ] The guard fires on force-reconnect, and a reconnect that recovers is reported.
- [ ] A run that produces zero transcript events exits with a **non-zero** status, or leaves
      a transcript that says it is empty on purpose — never a silent 0-byte file with exit 0.
- [ ] `doctor` unchanged: this is a runtime fault, not a setup fault, and `doctor` correctly
      reported everything healthy both before and after the incident.

## Why this ranks P0

The loss is silent and total, and it hits the one thing the tool exists for. The user in this
instance spoke for ten minutes, got a clean-looking exit, and only found out the content was
gone because the assistant went looking for it. A tool that loses work loudly is repairable;
one that loses it quietly trains people to stop trusting it.
