# Tasks

## 1. Capture stamps the label

- [ ] 1.1 `src/transcript-writer.ts`: `TranscriptWriterOptions.speakerNames?: { mic?: string; system?: string }`; `writeLine` stamps `line.speakerName` from the channel's resolved label when it is a non-empty string, never an empty one. Verify: `transcript-writer.test.ts` cases — mic labelled, system labelled, unlabelled channel writes no field. [REQ: A line records who the capturing machine says spoke]
- [ ] 1.2 `src/capture.ts`: pass `cfg.transcript.speakers` (both keys, trimmed) into the writer. Verify: a config→writer unit case in `transcript-writer.test.ts` feeding the resolved map, and `set-copilot transcript` on a capture-shaped file carrying `speakerName` renders the label (CLI run, documented in the commit). [REQ: A line records who the capturing machine says spoke]

## 2. The stitch prefers the recorded label

- [ ] 2.1 `src/transcript-build.ts`: `parseLines` reads `speakerName` onto `StitchLine` (non-empty string only); the sentence carries its channel's recorded label; the renderers resolve `speakerName ?? opts.speakers[s.speaker] ?? s.speaker`, and `renderJsonl` gains the same resolution (its `speaker` field is the raw channel today). The channel stays the grouping key — no rewrite of `line.speaker`. Verify: `transcript-build.test.ts` cases — recorded label beats a conflicting map, in `renderMarkdown` AND the structured jsonl; a pre-field line still maps through the config; a config entry keyed BY the label (and a `--speakers` override) does not rewrite it; equal labels on both channels keep the two channels' sentences distinct with overlap marked. [REQ: A recorded speaker label outranks the stitching machine's config]
- [ ] 2.2 `src/wall/server.ts` `transcriptPageLine`: prefer the line's `speakerName` over the serving machine's `transcript.speakers` map. Verify: a wall-server test case — a labelled line arrives labelled, an unlabelled line keeps the map (CLI-verifiable via `/api/transcript`). [REQ: The transcript page is opt-in by route]
- [ ] 2.3 End-to-end on a real capture-shaped file: `set-copilot transcript` on a recording with `speakerName` renders the label; the same file without the field renders the configured map (CLI run, documented in the commit). [REQ: A recorded speaker label outranks the stitching machine's config]

## 3. Whole-suite check

- [ ] 3.1 `npm run build && npm test` green. [REQ: A recorded speaker label outranks the stitching machine's config]
