# Proposal

## Why

The project has drifted through many ad hoc commits, and the code is now the source of truth. A drift
audit of every spec outside the parallel retro-spec work found requirements that describe mechanisms that
no longer exist, wording that contradicts the shipped behaviour, and behaviours that a future change could
break without noticing because no spec states them. This change brings those specs back in line with the
code. It changes no code.

## What Changes

- **Stale wording removed.** The mirror's "length cap / truncated" vocabulary (it divides messages into
  chunks), the "slot" producer mandate (it is now a category), alerts on the wall (they are chat-only),
  the `transzkript` producer example, and the graph-worker tombstone's pointer to removals "below" that
  no longer exist.
- **Contradictions resolved in the code's favour.** These cover:
  - Producers: settled content is emitted without a fork.
  - Fast-lane commands: accepted on either channel. Only name-addressing is mic-only.
  - Logging: `emittedAt` stamps display events only. The mirror log vocabulary is
    `emit`/`short`/`filler`/`dup`/`error`/`init`/`reset`.
  - Fencing: only when code blocks are kept.
  - Window routing: by zone **and** box subscription. Graph-visual swaps go through the server
    director, and render-type swaps wait on the client.
  - Fake-feed: `both`-zone and on by default.
  - Liveness: `lastHeardMsAgo` is the age of the transcript file's last write.
  - Replay: paced against the run start.
  - Recovery ledger: records the findings count; the stop gate gives up after three blocks.
  - Box policy: `maxLines`, not drawing conventions; the renderer prints only overridden keys.
  - Wall log: `wall --reset` is the only rotation.
- **Behaviour the specs never stated, now stated.** These cover:
  - The loopback bind, run-scoped resume ids, and the full-replay announcement.
  - Heartbeat interval, first beat, and the 4× disconnect rule.
  - Staging: the staged-zone rejection, the graph-only promotable registry, and the TTL key, clock gate
    and refresh.
  - The `wall-staged` no-wall error.
  - Box policy never served to clients.
  - Pending markers never replayed.
  - The `hideInput` switch.
  - Mirror: sidechain exclusion and transcript resolution, and the retired-hook cleanup.
  - The orphaned-follower repair.
  - Replay metadata stripping and recorded flags, and the player's own lateness record.
  - Text formatting: underscore-literal italics, heading shape, and ragged table rows.
- **Purposes fixed.** These are edited directly in the main specs:
  - `wall-feedback` gets a real Purpose; it was a TBD placeholder that failed `--strict`.
  - `live-narration` loses "private wall".
  - `graph-worker` loses its stale pointers.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `box-policy`: `maxLines` is box-scopable, drawing conventions are not; only overridden keys are rendered;
  the shipped narration box is current, not prospective; policy is never served to clients.
- `fork-producer`: settled content is emitted without a fork; mandates name a category; the seam is
  described as it is, `emittedAt` stamped by the append path.
- `graph-worker`: the tombstone points at the archived removal and at `wall-server`.
- `live-narration`: disabling narration removes the mandate and enabling only appends it (the
  "byte-for-byte" claim is replaced).
- `mirror-follower`: policy vocabulary, sidechain exclusion, transcript resolution, gate-closed skipping,
  the log's decision vocabulary and rotation, conditional fencing, retired-hook cleanup.
- `predictive-staging`: expiry by `wall.staging.ttlMs` with a clock-decided gate and private-only marker;
  CLI no-wall error; staged-zone rejection; graph-only registry.
- `recovery-ledger`: the completion command requires the findings and records their count; the end-of-session
  gate is bounded to three blocks.
- `runtime-repair`: an orphaned or stale `mirror.pid` is a reported fault.
- `text-formatting`: underscore is literal, heading shape, ragged table rows.
- `transcript-replay`: pacing from run start; only the playable line is written, flags as recorded; the
  player records its lateness.
- `wall-feed`: producer partition (forks for visuals, direct text lanes), alerts are chat-only, speaker
  scoping, `emittedAt` scope.
- `wall-input`: the input can be hidden by `wall.presentation.hideInput`.
- `wall-liveness`: heartbeat source, interval and first beat; client thresholds; how a stalled box is
  diagnosed.
- `wall-pending-indicator`: pending markers are not replayed state.
- `wall-scroll-replay`: only `--reset` rotates the log; a plain start rebuilds from it.
- `wall-server`: startup output and loopback bind, window routing, run-scoped resume and replay
  announcement, replay scope, director scope, producer example, fake-feed defaults.

## Impact

Specs only: `openspec/specs/` for the capabilities above, plus Purpose edits in `wall-feedback`,
`live-narration` and `graph-worker`. No code, configuration, skill or hook changes. Where the audit found
the spec right and the code wrong, the spec was left as it is and the item is listed as a suspected
regression in `design.md` for a follow-up change.
