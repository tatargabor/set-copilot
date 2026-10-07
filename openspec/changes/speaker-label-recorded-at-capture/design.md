# Design

## Context

`TranscriptWriter.writeLine` (`src/transcript-writer.ts:315`) builds each line and is the single
exit for speech lines; `capture.ts:162` constructs the writer and has `cfg`. Downstream,
`parseTranscript` (`src/transcript-build.ts:160-180`) whitelists the fields it reads, the channel
rebuild groups by `speaker`, `splitSentences` stamps each sentence with its channel's speaker,
and the renderers resolve the display name once — `const who = opts.speakers[s.speaker] ??
s.speaker` (`src/transcript-build.ts:513`).

## Goals / Non-Goals

**Goals:**

- Attribution travels with the recording; a second machine's config cannot rewrite it.
- Recordings without the field are untouched, byte-shape and behaviour.

**Non-Goals:**

- Attributing non-speech events or fast-lane verdicts.
- Retro-stamping old recordings (the stitch falls back to the map — "back-fill finds the ones
  that were not" does not re-write content).

## Decisions

- **Stamp in the writer, resolve in `parseTranscript`, no new render branch.** The writer writes
  `line.speakerName = names[channel]` when the resolved label is non-empty. At parse time the
  line's `speaker` IS RESOLVED to the recorded label when present — so the channel rebuild,
  sentence speaker, overlap marking, `--stats` speaker list and every renderer see the recorded
  name through the code path that already exists (`opts.speakers[label]` misses, falls back to
  the label itself). One resolution point, no second rendering path to keep in step. The
  alternative — carrying `speakerName` on `StitchedSentence` and adding a second `??` at every
  renderer — would spread the rule across three renderers and leave the rebuild/overlap logic
  keyed on channels while sentences carried names.
- **The label replaces the channel key downstream, safely.** A recording has exactly two
  channels and one label per channel, so grouping by the resolved name cannot merge or split
  channels that the channel key would not. The pathological case (mic and system configured to
  the SAME label) merges two channels into one rebuild — the same result today's map produces
  when both map to one name, and a config error either way.
- **`capture.ts` passes `cfg.transcript.speakers` through.** The writer takes
  `speakerNames?: { mic?: string; system?: string }` — the already-resolved per-machine keys
  (`machine-local-audio-and-speaker`), so the writer stays config-free and testable.
- **The CLI `--speaker` override becomes a fallback, not a veto.** It still maps channels for
  recordings without the field; it cannot re-attribute a recorded one. That is the point of the
  change.

## Risks / Trade-offs

- [A consumer of the structured `.jsonl` keyed on `speaker: "mic"`] → the stitched sentence
  `.jsonl` now carries the LABEL in its `speaker` field for new recordings. This is the intended
  change (the label is the identity); a consumer wanting the channel has the raw recording,
  whose `speaker` field is unchanged.
- [Old recordings stitched on the capturing machine] → unchanged: the map resolves as today.

## Migration Plan

None. New recordings carry the field from the first capture after the update; nothing reads it
mandatory.
