## 1. Rectangularity validation

- [x] 1.1 Extend `badLayout` (`src/wall/layout.ts:33`) with the bounding-box check: for each position, every cell inside its min/max row-column bounds must carry the same name (D3).
- [x] 1.2 Warn naming the offending position and layout id, and drop the window — matching the module's existing posture.
- [x] 1.3 Tests in `src/wall/layout.test.ts`: an L-shaped position and a diagonal position are both rejected; a full-height column span resolves; every shipped layout still resolves unchanged.

## 2. The three-region layout

- [x] 2.1 Add the layout to `DEFAULT_LAYOUTS`: `areas: [["szöveg","prezentáció"],["szöveg","kitűzött"]]`, `columns: ["1fr","1fr"]`, `rows: ["2fr","1fr"]`, with a comment recording that the left column is one region on purpose (D1).
- [x] 2.2 Confirm `gridTemplate` needs no change — it emits `grid-template-areas` row by row, so the span is already correct. Add a `wall-core` test asserting the generated template for the new layout.

## 3. The pinned box

- [x] 3.1 Add the pinned category to the shipped registry (`render: "text"`), with label and icon.
- [x] 3.2 Assign a `latest` box with **no** `pacing` to the `kitűzött` position (D2), and subscribe it to the new category only.
- [x] 3.3 Write the box `policy.instructions`: what belongs there (agenda, open questions, decisions, tasks), that it is replaced whole, and that it changes occasionally rather than continuously (D4/D5).
- [x] 3.4 Decided: the **public wall** (`/wall`) ships on `harom-regio` with the pinned box; the private view keeps `private-staging`, because that is where the staging lane lives and giving it up would be a regression. The private view can switch at runtime (`wall-layout / harom-regio`) - the layout is geometry, so the switch costs only the staging lane.
- [x] 3.5 Style the pinned region in `wall.css` — visually distinct from the stream (it is reference, not flow), light and dark.

## 4. Producer side

- [x] 4.1 In `skills/meeting-copilot/SKILL.md`, document how the copilot updates the pinned box: emit the block **in full** every time, because a `latest` box replaces rather than merges (D5).
- [x] 4.2 State the cadence expectation in the same place — this is reference content, not a second stream.

## 5. Verify

- [x] 5.1 `npm run build` clean under `tsc` strict; `npm test` green.
- [x] 5.2 Run the wall on the new layout and confirm three regions render with the left column spanning both rows.
- [x] 5.3 Emit a long run of stream events and confirm the pinned content stays visible, unshrunk and unmoved.
- [x] 5.4 Emit a replacement pinned block and confirm it replaces in full.
- [x] 5.5 Emit a pinned block containing a redaction-matching string to a public window and confirm redaction still applies.
- [x] 5.6 Point a window at a deliberately L-shaped layout and confirm the warning + drop, with the other window still serving.
