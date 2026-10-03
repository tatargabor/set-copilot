# Design

## Context

This is a retro-spec drift audit (see proposal.md, Why). The code is the source of truth. One rule decides
each item: **if the code is deliberate, the spec follows the code**. Deliberate means a code comment,
a test, an archived design or CLAUDE.md states the behaviour. **If the spec states the intent and the code
looks like it regressed, the spec stays as it is**, and the item is listed below under "Suspected
regressions" for a follow-up change.

## Goals / Non-Goals

**Goals:** make every audited spec describe the shipped behaviour. Restate the behaviours a future change
could break silently. Give `wall-feedback` a real Purpose.

**Non-Goals:** code changes. The capabilities covered by the parallel retro-spec changes (audio,
transcript, config, lifecycle, display-layout and display-categories, public-redaction, wall-presentation,
replay-scorecard and replay-scenario, and others) are out of scope. `chat-mirror` and
`transcript-recovery` were audited, and their only findings are regressions or cross-references, so they
are untouched.

## Decisions

| Spec | Drift item | Decision |
|---|---|---|
| mirror-follower | "length cap", "truncate" verdicts are stale; the policy returns `emit`/`short`/`filler` plus chunks (`src/mirror-policy.ts:78`) | Spec follows code |
| mirror-follower | Sidechain/thinking/tool blocks are excluded (`src/mirror-follow.ts:103`); the transcript is resolved from `--transcript`, `--session`, or the runtime dir basename (`src/cli.ts:663`, `src/mirror-follow.ts:149`) | Added to spec |
| mirror-follower | A message written while the gate is closed is skipped for good (`src/mirror-follow.ts:345`, comment "advance past it silently") | Added to spec |
| mirror-follower | Log vocabulary is `init`/`reset`/`short`/`filler`/`dup`/`error`/`emit`, with no "truncated"; the live log rotates at 2000 lines, never truncated (`src/mirror-follow.ts:59,207`) | Spec follows code |
| mirror-follower | Aligned blocks are fenced only when `codeBlocks: "keep"` (`src/mirror-policy.ts:84`) | Spec follows code |
| mirror-follower | `init` removes `wall-mirror.sh` (`src/cli.ts:551`); `doctor --mirror` warns about it (`src/diagnostics.ts:360`) | Added to spec |
| live-narration | The "byte-for-byte pre-change" scenario cannot hold; the test asserts "enabled = disabled + appended mandate" (`src/copilot-prompt.test.ts:475`) | Scenario reframed to the tested intent |
| live-narration | Purpose said "private wall"; the shipped default is a single public wall | Purpose edited |
| fork-producer | Settled content is emitted directly (`skills/meeting-copilot/SKILL.md:345`); "slot" is now "category"; the seam text was written as a change delta | Spec follows code |
| graph-worker | Says removals are "below" and points at the `monitor-wall-display` change name | Text and Purpose corrected |
| predictive-staging | Expiry is TTL-only (`wall.staging.ttlMs`, default 120 s), decided by the clock at promote time, refreshed by each staged delta, with a private-only marker that dims and badges the box rather than removing it (`src/wall/server.ts:559,607,760`; `src/wall/public/wall.js:708`) | Spec follows code |
| predictive-staging | `staged:true` on a non-private zone is rejected whole (`src/wall/emit.ts:183`); only a graph with a `visual` id is registered (`src/wall/server.ts:760`); `wall-staged` exits 1 when no wall runs (`src/cli.ts:295`) | Added to spec |
| recovery-ledger | `mark` requires a JSON array and stores only its count (`src/cli.ts:960-972`); the hook gives up after `MAX_NUDGES=3` (`hooks/recovery-guard.sh:40,68`) | Spec follows code (CLAUDE.md documents both) |
| runtime-repair | The skill checks `mirror.pid` as a fault (`skills/set-repair/SKILL.md:71`) | Added to spec |
| transcript-replay | Lines are scheduled from the run start (`src/replay.ts:75`; test "computes from the start") | Spec follows code |
| transcript-replay | Only the playable line is written (`src/replay-scenario.ts:159`); flags are not recomputed; `maxLatenessMs` is recorded and a warning printed (`src/replay.ts:183`) | Added to spec |
| wall-feed | Producers: visuals use forks, text lanes are direct, the mirror is a process; alerts are chat-only; a `transcript` category is dropped at ingest (`src/wall/server.ts:745`) | Spec follows code |
| wall-feed | Fast-lane commands work on any channel, and only `detect.command` is mic-only (`src/transcript-writer.ts:211,347`) | Spec follows code |
| wall-feed | `emittedAt` stamps display events only; `pending`/`promote`/`layout` lines are unstamped (`src/wall/emit.ts:349-392`) | Spec follows code |
| wall-input | `wall.presentation.hideInput` removes the input (`src/wall/public/wall.js:542`) | Spec follows code |
| box-policy | `BoxPolicy` = instructions/alerts/engagement/maxLines (`src/config.ts:276`); only overridden keys are rendered (`src/copilot-prompt.ts:383`); the narration box ships (`src/config.ts:640`) | Spec follows code |
| box-policy | Policy is stripped from the bootstrap (`src/wall/server.ts:75`) | Added to spec |
| text-formatting | Underscore is literal; headings are 1–6 `#` with at most 3 spaces of indent; ragged rows are padded (`src/wall/public/text-format.mjs:27,129,205`) | Spec follows code |
| wall-server | Startup prints per-window audience/zones/layout (`src/wall/index.ts:177`); binds 127.0.0.1 (`src/wall/server.ts:383`) | Spec follows code / added |
| wall-server | Routing requires both zone match and a subscribing box; legacy `slots`; the default is a single `/wall` | Spec follows code |
| wall-server | Resume ids are scoped to the run, and the full-replay announcement is sent before the replay (`src/wall/server.ts:288,1327`; `src/wall/public/wall.js:437`) | Added to spec |
| wall-server | Graphs are replayed only for paced categories (`src/wall/server.ts:1014`); the director governs only graph-visual swaps, and render-type swaps are deferred client-side (`src/wall/public/wall.js:768`) | Spec follows code |
| wall-server | The fake-feed is `both`-zone, on by default, and kept out of the log (`src/wall/feed-script.ts:9`, `src/cli.ts:283`); the producer example used the nonexistent `transzkript` | Spec follows code |
| wall-liveness | `lastHeardMsAgo` is the transcript file's mtime (`src/wall/server.ts:442,500`); the interval is 1000 ms with an immediate beat on connect; disconnect after 4× the interval; quiet at 4 s; `heartbeatMs:0` means no status | Spec follows code |
| wall-liveness | There is no per-box arrival indicator; a stalled box is diagnosed from the strip plus the log | Scenario reframed |
| wall-scroll-replay | Only `--reset` rotates, after the live check; a plain start rebuilds (`src/wall/index.ts:73,132`) | Spec follows code |
| wall-pending-indicator | Pending markers are not accumulated or replayed (`src/wall/server.ts:673`) | Added to spec |
| wall-feedback | The Purpose was a TBD placeholder | Purpose written |

## Suspected regressions (spec kept, code looks wrong)

- **mirror-follower, long list or table.** `chunkBlocks` treats a whole list as one block and cuts its
  tail (`src/mirror-format.ts:194-204,287-292`). A heading plus a 9-item list loses items 4–9, and a
  large table is cut mid-row. The spec says "every item SHALL reach the wall".
- **mirror-follower, stop without a marker.** `drainMirrorAtStop` returns before killing the follower
  when `wall-mirror.enabled` is missing (`src/cli.ts:708`). The stop path also drains while the live
  follower is still running.
- **mirror-follower, undeliverable at stop.** A message pending when the wall is already down is skipped
  silently, not reported by uuid (`src/mirror-follow.ts:345`, `src/cli.ts:717`).
- **predictive-staging, restart revives expired predictions.** The rebuild re-registers staged visuals
  with `Date.now()` and re-runs logged promotes (`src/wall/server.ts:761`). A promote refused live can
  publish at restart.
- **predictive-staging / fork-producer, unscoped commands taught.** `npx set-copilot wall-staged` and
  `wall-emit` are rendered without `SET_COPILOT_DIR` (`src/copilot-prompt.ts:266,291`,
  `skills/meeting-copilot/SKILL.md:382`). They miss the session's wall, and they force the fork mandate
  to re-supply the emit line.
- **predictive-staging, expired guess on reload.** `stage-expired` is not replayed, so a reloading
  private view shows the expired guess as live. `onStageExpired` also dims every box of the category,
  regardless of `visual`.
- **fork-producer, category ids hardcoded.** The skill and the rendered narration mandate name
  `narráció`/`kitűzött`/`tükör`/`előrejelzés` (`skills/meeting-copilot/SKILL.md:250,270,285,379`;
  `src/copilot-prompt.ts:172`). The spec says a rename needs no skill edit.
- **recovery-ledger, guard inert.** The skill writes `recovery.active` into the unscoped runtime dir;
  the hook looks under `.set/copilot/$SESSION_ID/`.
- **recovery-ledger, nudge counter.** The counter is never reset.
- **recovery-ledger, re-review not refused.** `claim`/`mark` re-run a done review without `--force`.
- **recovery-ledger, open claims hidden.** Open claims are reported without their claim time and only
  within the scanned dirs.
- **recovery-ledger, unknown state.** An entry with an unknown or missing `state` reads as done
  (`src/recovery-ledger.ts:118`).
- **recovery-ledger, pre-ledger artifacts overwritten.** Batch stitch rewrites pre-ledger artifacts,
  and `set-repair` calls this safe.
- **transcript-recovery, grades missing.** Transcripts stitched at `stop` produce no grade statistics
  without `--force`.
- **wall-feed / prompt, turn order.** The turn-order text says "first tool call: `wall-emit` with the
  reaction" (`src/copilot-prompt.ts:124`), while alerts are chat-only (`:324`).
- **wall-feedback, ack rules hardcoded.** The skill hardcodes the acknowledgement and ambiguity rules
  regardless of `copilot.acknowledge` (`skills/meeting-copilot/SKILL.md:362,365`).
- **wall-input, wrong route recorded.** The input record's `route` is always the first window's
  (`src/wall/server.ts:1116`).
- **box-policy, conflicting line budgets.** The default prompt states two budgets: narration
  `maxLines: 1` and the narration box `maxLines: 2`.
- **wall-server, partial line lost.** The tailer counts a half-written trailing line as consumed and
  loses it (`src/wall/event-source.ts:50-58`).
- **wall-server, remount wipes replay.** A client remount after a runtime layout switch, or after a
  config change across restart, wipes the replayed state (`src/wall/public/wall.js:128,168,415`).
- **wall-scroll-replay, order and time.** Replayed scroll lines are grouped by category, not in arrival
  order, and stamped with the render time instead of `emittedAt` (`src/wall/server.ts:997`,
  `src/wall/public/wall.js:1050`).
- **wall-pending-indicator, TTL too short.** The default TTL is 20 s (`src/wall/emit.ts:206`), below the
  measured 16–62 s fork draw, and the skill passes no `ttlMs`.

## Risks / Trade-offs

- [Encoding a doubtful behaviour as a requirement] → Items whose intent is unclear are either stated
  neutrally (the graph-only staging registry) or left to the regression list. None of them is
  hardened into a "SHALL keep doing this".
- [Overlap with the parallel retro specs] → Items owned there (the transcript page, presentation, the
  layout switch surviving a restart, the process lifecycle) were not added here.
