# Tasks

## 1. Capture stamps the label

- [ ] 1.1 `src/transcript-writer.ts`: `TranscriptWriterOptions.speakerNames?: { mic?: string; system?: string }`; `writeLine` stamps `line.speakerName` from the channel's resolved label when it is a non-empty string, never an empty one. Verify: `transcript-writer.test.ts` cases — mic labelled, system labelled, unlabelled channel writes no field. [REQ: A line records who the capturing machine says spoke]
- [ ] 1.2 `src/capture.ts`: pass `cfg.transcript.speakers` (both keys, trimmed) into the writer. Verify: a config→writer unit case in `transcript-writer.test.ts` feeding the resolved map, and `set-copilot transcript` on a capture-shaped file carrying `speakerName` renders the label (CLI run, documented in the commit). [REQ: A line records who the capturing machine says spoke]

## 2. The stitch prefers the recorded label

- [ ] 2.1 `src/transcript-build.ts` `parseTranscript`: read `speakerName`; when it is a non-empty string, resolve the line's `speaker` to it, so the rebuild, the sentences and every renderer attribute the recorded label through the existing `opts.speakers[x] ?? x` fallback. Verify: `transcript-build.test.ts` cases — recorded label beats a conflicting map, in `renderMarkdown` and the sentence stream; a pre-field line still maps through the config; a config entry keyed BY the label does not rewrite it. [REQ: A recorded speaker label outranks the stitching machine's config]
- [ ] 2.2 End-to-end on a real capture-shaped file: `set-copilot transcript` on a recording with `speakerName` renders the label; the same file without the field renders the configured map (CLI run, documented in the commit). [REQ: A recorded speaker label outranks the stitching machine's config]

## 3. Whole-suite check

- [ ] 3.1 `npm run build && npm test` green. [REQ: A recorded speaker label outranks the stitching machine's config]
