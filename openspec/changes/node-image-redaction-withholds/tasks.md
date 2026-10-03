# Tasks

## 1. A node image is a structured source in the withhold decision

- [x] 1.1 Write the failing tests first, in the "URL sources withhold the whole event" block of `src/wall/redaction.test.ts`: a three-node delta where only the second node's string `image` matches is withheld whole (`public === null`, private unchanged and marked `withheld`); a node whose `image` is an array with one matching element is withheld; clean node images pass unchanged; a delta with a `null` entry in `nodes` and otherwise clean content is NOT withheld. Run them against the unfixed `redaction.ts` and record which fail (the two withhold cases must fail). [REQ: A matching URL withholds the event, it is not scrubbed]
- [x] 1.2 In `src/wall/redaction.ts`, extend the structured-source check used by `splitForZones`: for every node of `graph.nodes`, read defensively, check every string leaf under its `image` key at any depth; update the D2 doc comment to name all three sources. Verify: the 1.1 tests now pass; `npx vitest run src/wall/redaction.test.ts` is green. [REQ: A matching URL withholds the event, it is not scrubbed]

## 2. The withheld delta never reaches a public replay, and the operator is told correctly

- [x] 2.1 Add a server-level test to `src/wall/server.redaction.test.ts`, run once before 1.2 to confirm it fails: a `both`-zone graph delta with a clean node (`id: "clean-node"`) and a node whose `image` matches is not broadcast to a public client, and the clean node's id appears neither in live public frames nor in the replay of a public client that connects afterwards, while a private client's replay contains both nodes. Assert also that no public frame carries the redaction replacement inside a node `image`. [REQ: A matching URL withholds the event, it is not scrubbed]
- [x] 2.2 Keep the private slice's marker severity: when a withheld delta folds into a private slice, the slice records `withheld`, which wins over `redacted`, and the private replay sets `redaction` from it. Verify: an assertion in the 2.1 test that a private client reconnecting after the withheld delta receives the visual marked `withheld`, not `redacted`. [REQ: Graph nodes and edges carry optional presentation attributes]

- [x] 2.3 In `src/wall/server.ts`, hold a visual back after a withheld graph delta: track a per-(category, visual) public hold, set it when a graph delta's public variant is withheld, clear it when a `reset` of that visual reaches the public zone, and while it is set replace later deltas' public variant with a withheld one (private marked `withheld`) before `accumulate` and `broadcastEvent`. Verify: a `server.redaction.test.ts` case, written and run failing first — a withheld `reset` of `v2`, then a clean `add` of `v2`: no public frame and no public replay contains either; a private client gets both; a following clean `reset` of `v2` reaches the public client. [REQ: A matching URL withholds the event, it is not scrubbed]

## 3. The producer is taught the rule

- [x] 3.1 In `src/copilot-prompt.ts`, the redaction line of the drawing contract (currently "…withholds the event if the marker lands in an `image.src`/`webpage.url`") names a graph node's `image` too; update any `copilot-prompt.test.ts` assertion on that text. In CLAUDE.md's public-zone redaction bullet, name the node `image` alongside `image.src`/`webpage.url` (docs). Verify: `npx vitest run src/copilot-prompt.test.ts` passes and `npm run dev -- prompt | grep -n 'image'` shows the new wording. [REQ: A matching URL withholds the event, it is not scrubbed]

## 4. Whole-suite check

- [x] 4.1 Run `npm run build && npm test`; both pass with no new warnings. [REQ: A matching URL withholds the event, it is not scrubbed]
