## Why

`transcript-stitch` fixed the meeting path and deliberately left dictation alone, on the
reasoning that there the raw text *is* the user's message, not a document. That reasoning was
right about the artifacts and wrong about the text.

`skills/dd/SKILL.md` instructs the model:

> Parse the JSONL lines: concatenate the `text` fields of `final: true` lines into one block.

No separator is specified, and the skill has never heard of `cont` / `midWord`. From a real
dictation (`dictation-2026-07-27T11-53-28-183Z.jsonl`):

```
11580 [partial] "Az lenne a kérdésem, hogy a SetPromo-ból a ide, a"
16140 [cont]    "meetingek át lettek szedve?"
```

Concatenated literally, the user's own question arrives as `…a ide, ameetingek át lettek
szedve?`. Insert a space instead and the next `midWord` boundary splits a word in half. Either
way the model is guessing at exactly the question `cont`/`midWord` were recorded to answer — and
it re-guesses on every dictation, because the guess lives in a prompt.

This is a sharper failure than the meeting one. A meeting transcript is read later, by someone
who can go back to the recording. A dictation is an **instruction**, corrupted before the model
reads it, with no second chance to notice.

The fragmentation here does not come from cross-channel cutting — in `--mic-only` the system
client is never constructed — but from the 80-token overflow and the speaker's own 3s silence,
both of which fire constantly in normal speech.

## What Changes

- **`set-copilot stop --print` emits stitched plain text** instead of raw JSONL. Archival is
  untouched: the same single `renameSync`, the same exactly-once guarantee. Only what reaches
  stdout changes.
- **New plain-text renderer** in the stitch engine — sentences with correct word boundaries and
  nothing else. No timestamps, no speaker labels: in dictation both are noise, and the existing
  markdown renderer's `**[00:00:11] mic:**` prefixes are meeting furniture.
- **The parsing instruction disappears from `skills/dd/SKILL.md` and `skills/dictate/SKILL.md`.**
  This is the load-bearing part. While the prompt still says "concatenate", a model will keep
  re-deriving a word-boundary rule it has no information to derive. The skill's job becomes:
  the output is the user's message, act on it.
- **A stitch failure falls back to the raw contents** — today's behavior — rather than printing
  nothing. Losing a dictation is worse than a badly joined word boundary.
- **Dictation still gets no derived artifacts.** `transcript-stitch` decided that deliberately
  and it stays: the text is a message, not a document.

## Capabilities

### New Capabilities
- `dictation-output`: what the dictation stop path emits — reassembled sentences rather than
  fragments the caller must rejoin, the removal of any reassembly obligation from the consumer,
  the empty-dictation behavior, and the fail-open fallback that never loses a dictation.

### Modified Capabilities
- `meeting-transcript-persistence`: the dictation (`--print`) branch now emits stitched text
  rather than the raw transcript body. The exactly-once archival, the meeting branch, and the
  derived-artifact rules are unchanged.

**Archive order.** This modifies a requirement `transcript-stitch` already modified (its
"Dictation still prints and archives once" scenario lives inside it). `transcript-stitch` must be
archived **first**, and this delta must carry forward the text as that change left it — otherwise
the archiver drops scenarios.

## Impact

- **Modified**: `src/transcript-build.ts` (plain renderer), `src/handover.ts`
  (`printTranscriptOnce`), `skills/dd/SKILL.md`, `skills/dictate/SKILL.md`, `src/index.ts`.
- **Unaffected**: the audio chain, capture, the meeting stop path, the wall, `/ds`, and the
  archival invariants.
- **Dependencies**: none — the stitch engine already exists.
- **Behavioral risk**: any consumer that parsed `stop --print` output as JSONL breaks. The two
  skills are the only consumers in the repo, and both are updated here; `printTranscriptOnce`
  is exported from the library, so the change is noted for external callers.
