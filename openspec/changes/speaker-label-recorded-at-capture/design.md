# Design

## Context

`TranscriptWriter.writeLine` (`src/transcript-writer.ts:315`) builds each line and is the single
exit for speech lines; `capture.ts:162` constructs the writer and has `cfg`. Downstream,
`parseLines` (`src/transcript-build.ts:142`) whitelists the fields it reads, the channel
rebuild groups by `speaker`, `splitSentences` stamps each sentence with its channel's speaker,
`renderMarkdown` resolves the display name once — `const who = opts.speakers[s.speaker] ??
s.speaker` (`src/transcript-build.ts:513`) — and `renderJsonl` never applies the map at all
today. The wall's live transcript page re-derives labels from the serving machine's map
(`src/wall/server.ts:1348`).

## Goals / Non-Goals

**Goals:**

- Attribution travels with the recording; a second machine's config cannot rewrite it.
- Recordings without the field are untouched, byte-shape and behaviour.
- The channel stays the internal grouping key — attribution can never merge or split channels.

**Non-Goals:**

- Attributing non-speech events or fast-lane verdicts.
- Retro-stamping old recordings (the stitch falls back to the map — "back-fill finds the ones
  that were not" does not re-write content).

## Decisions

- **The label rides beside the channel; the channel stays the grouping key.** `parseLines` reads
  `speakerName` onto `StitchLine`; the sentence, built per channel, carries the channel's label;
  every renderer resolves `who = sentence.speakerName ?? opts.speakers[s.speaker] ??
  s.speaker`. Resolving at RENDER (not by rewriting `line.speaker` at parse) is load-bearing:
  the rebuild, overlap marking and rotation repair all key on the channel (`transcript-build.ts:323,422,219`),
  and a parse-time rewrite would merge the two channels' rebuild whenever a config resolves both
  labels to the same string — a silent cross-channel reassembly, with every overlap mark gone,
  where today's identical config error degrades cosmetically. One resolution expression, shared
  by the renderers; the label map is built once at parse.
- **The recorded label is terminal, even for the operator.** `--speakers gazda=X` and a config
  entry keyed by the label are both ignored for a labelled line: the whole point is that no
  later machine's config re-attributes. A label recorded WRONG (a typo in the capturing
  machine's config) is corrected there and by re-recording, not by re-stitching — the raw
  recording's `speaker` channel field remains for tooling that wants the channel.
- **`renderJsonl` gains the same resolution.** It never applied the map — the structured
  artifact's `speaker` is the raw channel today. New recordings get the recorded label there
  too, identically to the Markdown (the wall-feed style: both artifacts attribute the same).
- **`capture.ts` passes `cfg.transcript.speakers` through.** The writer takes
  `speakerNames?: { mic?: string; system?: string }` — the already-resolved per-machine keys
  (`machine-local-audio-and-speaker`), so the writer stays config-free and testable.
- **The wall transcript page reads the label too.** `transcriptPageLine`
  (`src/wall/server.ts:1348`) prefers `o.speakerName` over its map — otherwise the live page on
  a moved recording re-attributes exactly as the stitch did, the failure this change exists to
  end, in a sibling path.
- **The CLI `--speakers` override becomes a fallback, not a veto.** It still maps channels for
  recordings without the field; it cannot re-attribute a recorded one.

## Risks / Trade-offs

- [A consumer of the structured `.jsonl` keyed on `speaker: "mic"`] → for new recordings the
  structured line's `speaker` now carries the label. This is the intended change (the label is
  the identity); a consumer wanting the channel has the raw recording, whose `speaker` field is
  unchanged. Dictation is single-channel, so its structured output changes only when a label is
  configured.
- [Old recordings stitched on the capturing machine] → unchanged: the map resolves as today.

## Migration Plan

None. New recordings carry the field from the first capture after the update; nothing reads it
mandatory.
