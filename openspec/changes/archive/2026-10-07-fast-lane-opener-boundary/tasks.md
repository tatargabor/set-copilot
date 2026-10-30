# Tasks

## 1. Opener confirmed by an observed boundary

- [x] 1.1 Write failing tests in `src/fast-lane.test.ts` first: the three field phrases („Meeting Copilotot", „Copilotokat", „Set Copilotos") fed as token sequences with the suffix in its own token produce no event; a standalone opener confirmed by the next word's token and by a punctuation token produces the expected command; a closer as the last token closes at once. Run against the unfixed code and record which fail (the three field phrases must). [REQ: Markers match whole words, accent- and case-insensitively]
- [x] 1.2 In `src/fast-lane.ts`, make the opener search require an observed separator after the marker (closers unchanged); update the module and `findWord` doc comments. Verify: `npx vitest run src/fast-lane.test.ts` green, including the existing cases. [REQ: Markers match whole words, accent- and case-insensitively]

## 2. Pending buffer trimmed on a word boundary

- [x] 2.1 Test first: a pending buffer longer than the cap whose cut falls inside `…autocopilot` followed by an instruction and a closer opens nothing. Then trim `pending` on a word boundary in `src/fast-lane.ts`. Verify: `npx vitest run src/fast-lane.test.ts`. [REQ: Markers match whole words, accent- and case-insensitively]

- [x] 2.2 Test first: a chunked backend's two chunks (`Na jó, Copilot` | `rajzold fel csináld`) through `chunkEventText` open and close one command. Then make `SonioxChunkClient` and `WhisperLocalClient` emit `chunkEventText(text)`. Verify: `npx vitest run src/fast-lane.test.ts src/soniox-rt.test.ts src/whisper-local.test.ts`. [REQ: Markers match whole words, accent- and case-insensitively]

## 3. Docs and whole suite

- [x] 3.1 CLAUDE.md fast-lane paragraph: state that an opener needs an observed boundary and why (Hungarian suffix tokens, 2026-10-07), closers do not. Run `npm run build && npm test`. [REQ: Markers match whole words, accent- and case-insensitively]

## Evidence (2026-10-07)

Against the unfixed `fast-lane.ts`, the new tests failed exactly where intended — `„Meeting Copilotot”`, `„Copilotokat”`, `„Set Copilotos”` and the mid-word trim (4 failed, 18 passed); after the fix `npx vitest run src/fast-lane.test.ts src/transcript-writer.test.ts` is green.
