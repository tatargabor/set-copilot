## Context

`FastLane.feed(speaker, text, ts, now)` receives every Soniox token before any flush, keeps a rolling
`pending` buffer per speaker, and opens a span on the earliest whole-word opener anywhere in that
buffer. Neither the channel nor the position is checked. Two false-positive sources were observed:
the product's own name used as a noun on either channel, and a remote participant's ordinary
"start … stop".

## Goals / Non-Goals

**Goals:**
- Zero false `command-abandoned` on a replay of the meeting that exposed it, measured by a committed command.
- A deliberate mic address keeps working, including when split across tokens.
- Every new rule is config with a default.

**Non-Goals:**
- No change to the closing words, the extraction, or the abandonment caps.
- No speaker separation inside the system channel.
- Running replay through `transcript-writer`.

## Decisions

**D1. Channel gate in `feed`, before any buffering.** A speaker not in `channels` returns `[]` and
touches no state. A remote participant is never the operator, and a completed false command is
executed. *Alternative:* utterance start alone — it also reaches 0 on the measured meeting, but a
sentence-initial remote "Start … stop" would still complete. Rejected.

**D2. Utterance start = no letter or digit before the opener since the last sentence terminator or
a pause.** A same-speaker gap of at least `utterancePauseMs` (token time) clears `pending`. The opener
search walks raw words; a mid-sentence opener is skipped, so a sentence-initial one later in the same
buffer is still found. Truncating `pending`, and abandoning a span mid-speech, prefix a placeholder
word so neither manufactures an utterance start. *Alternatives:* a two-word wake phrase (new
vocabulary, still fires mid-sentence); a filler allow-list (a language fact; no measured case).
Rejected.

**D3. Defaults:** `channels: ["mic"]`, `utteranceStart: true`, `utterancePauseMs: 1500` (half the
writer's 3 s silence flush), `start: ["copilot"]`. A malformed value, including an empty channel
list, falls back to the default: disarming is said with `enabled: false`.

**D4. The measuring stick is a line-level replay.** `scripts/fast-lane-replay.ts` resolves the
project config and feeds each speech line as one piece per speaker in file order; `--legacy` replays
the earlier rule. It is a consistent ruler for comparing rules, not a recreation of the token stream:
the measured meeting logged 16 abandons live and replays to 11 under the old rule. Unit tests use
invented sentences; a real transcript is never committed.

**D5. Policy sentence.** `renderFastLane` names the channel and the utterance-start rule.

## Risks / Trade-offs

- **[A command after a filler ("öö, Copilot …") is missed]** → no measured case; a miss emits
  nothing and the speaker repeats it; `utteranceStart: false` restores the old rule.
- **[Recogniser punctuation is a guess]** → the pause is a second path to an utterance start.
- **[A single diarized stream with other speaker names]** → set `channels` explicitly.

## Migration Plan

No schema bump; the new keys are optional. Rollback is a revert.
