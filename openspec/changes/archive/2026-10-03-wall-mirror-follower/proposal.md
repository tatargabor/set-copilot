## Why

The chat→wall mirror runs as a `Stop` hook, and a live wall test on 2026-07-29 measured what that
shape costs.

The first report from that session — that the mirror "silently stopped at 20:52:39" — **does not
hold, and the truth is worse.** Verified on the artifacts: `wall-events.jsonl`'s last write was
20:57:40, the mirror was alive to the end, and the message it never delivered passed the policy
cleanly (`mirror-policy --apply` exits 0 on it, returning 641 of its 2143 characters). What the
timestamps actually show is a mechanism **permanently one message behind**:

| measured | |
|---|---|
| last mirrored message, written at | 20:57:02 |
| the next message ("Fejlesztési igények"), written at | 20:57:39.8 |
| the hook's emit, 0.2 s later | 20:57:40 → delivered the **20:57:02** message |

The hook reads the transcript at turn end, so it delivers the last block it can *see*, racing the
final block's flush to disk. It also takes only the turn's last text block (`jq … | last`), so
everything said mid-turn is discarded outright — on a wall whose purpose is showing what the copilot
is doing. And a session's **closing summary can never be mirrored at all**: it is written in the
same turn that stops the wall.

None of this was diagnosable from the outside, which is why the first report got it wrong: the
mirror keeps no record, its emit discards errors (`|| true`), and its de-duplication stamp is
written *before* delivery — so a failed emit is invisible *and* can never be retried.

The enabling fact for the fix: the transcript is appended **during** the turn (verified — this
session's assistant entries were on disk mid-turn). Followed continuously, the same file delivers
every message at the moment it is written, with no race and no turn boundary. That is what the
operator asked for, with an explicit acceptance bar: *near-zero latency difference between a line
appearing in Claude Code and appearing on the wall* — and, equally explicit, that the material must
arrive **formatted**, not merely fast.

## What Changes

- **Add `set-copilot mirror-follow`**, a long-running follower of the Claude Code session
  transcript. It resumes from a byte offset (like `poll-offset`), emits **every** new assistant
  text block in file order, and applies the existing `copilot.mirror` policy to each — one policy,
  one implementation.
- **BREAKING (mechanism, not config): the `Stop` hook is replaced, not supplemented.** Two sources
  feeding one wall box means two implementations free to disagree and double lines. `set-copilot
  init` stops registering `wall-mirror.sh` for the mirror and removes the registration it
  previously added; the shipped hook script is retired. Mirroring stays *more* structural than
  before — the follower does not depend on the model, and now does not depend on a hook firing.
- **Make the mirror observable.** The follower writes `wall-mirror.log` (when it read, what it
  decided per message: emitted / filler / duplicate / error), and `doctor --mirror` reports whether
  the follower is running and when it last emitted. "Silently skipped" and "never ran" become
  distinguishable, which is what made the field failure undiagnosable.
- **Lifecycle joins the runtime dir's existing rules.** `mirror.pid` + `mirror-offset` alongside
  `capture.pid`/`poll-offset`; a second follower in a live runtime dir is refused; `stop` stops it.
- **The material arrives formatted, which takes four separate fixes.** The wall already renders a
  closed markdown subset (`text-format.mjs`), but "don't break it" is not enough:
  - **Length control stops discarding content.** A long message is delivered as consecutive events
    on block boundaries — the scrolling box accumulates them — instead of being cut at a character
    count. Measured: the operator's nine-item report is 2143 characters and the current policy
    returns 641, *one item of nine*, cut mid-sentence.
  - **Headings render as headings.** Verified: `## Fejlesztési igények` reaches the wall with its
    hashes, and a test asserts that literal degradation on purpose. A mirrored Claude Code message
    is heading-structured, so the closed text vocabulary gains a `heading` block — a deliberate
    engine change, in the same sense as adding a `RenderType` would be. This also closes field
    backlog #17.
  - **Monospace-dependent content is fenced by the delivery path, not by asking the copilot.** The
    field test's ASCII table arrived unfenced in a proportional font because the copilot was working
    around a code-block stripping that no longer happens. Trading one piece of prompt discipline for
    another would reproduce the failure this change exists to end.
  - **The contract stops lying.** `skills/meeting-copilot/SKILL.md:32` still says the mirror "strips
    code blocks" and "skips short filler (<40 chars)" — stale since the default became `keep`. The
    mirror block in `set-copilot prompt` is rendered from the **resolved** config instead of
    restated by hand.
- **Delivery is confirmed before it is forgotten.** The offset and the de-duplication stamp advance
  only after a successful emit, and a failed emit is logged and retried instead of discarded — the
  hook did the opposite in both respects.
- **The closing summary can finally be mirrored.** `stop` drains the follower before the wall goes
  down, and reports anything it could not deliver rather than exiting as if it had.
- **The opt-in precondition changes with the mechanism.** Enabling mirroring verified that the
  `Stop` hook was registered; it now verifies that the follower started, and fails loudly with the
  command that starts it.

## Capabilities

### New Capabilities
- `mirror-follower`: the continuous transcript-follower mechanism — lifecycle (start/stop/single
  instance), resumable offset, per-message ordering and delivery, the operations log, and the
  latency contract with its honest floor (the transcript carries whole messages, not tokens).

### Modified Capabilities
- `chat-mirror`: the enforcement mechanism changes from a `Stop` hook to the follower (the
  hook requirement is removed and replaced); the opt-in precondition now checks the follower;
  the length budget governs how a message is *divided* rather than how much of it survives; and the
  contract reports the *resolved* code-block behaviour instead of a hard-coded claim.
- `text-formatting`: the closed text vocabulary gains a `heading` block, so a mirrored
  heading-structured message renders as sections instead of showing its `#` characters.

## Impact

- **New**: `src/mirror-follow.ts` (follower + offset/PID lifecycle), its unit tests over the pure
  parts (transcript parsing, offset advance, per-message decisions).
- **Changed**: `src/cli.ts` (`mirror-follow` command, `stop` drains then stops the follower, `init`
  no longer registers the mirror hook and de-registers it), `src/doctor.ts` + `src/diagnostics.ts`
  (`--mirror` reports follower state and last emission), `src/config.ts` (the length budget as a
  chunking budget), `src/copilot-prompt.ts` (mirror contract rendered from resolved config),
  `skills/meeting-copilot/SKILL.md` (mechanics: follower, not hook).
- **Changed (wall client)**: `src/wall/public/text-format.mjs` + `text-render.mjs` + `wall.css` gain
  the `heading` block; `src/wall/text-format.test.ts` moves `"# not a heading"` out of its
  literal-degradation list — that test encodes the intent being changed, so it changes with it.
- **Removed**: `hooks/wall-mirror.sh` and its `Stop` registration.
- **Untouched by design**: the wall server, `ingest`, redaction, and the event schema — the payload
  stays a plain string, so the `heading` addition is render-time only. The follower emits through
  `wall-emit` with `zone:"both"` exactly as the hook did, so public-zone redaction still runs
  server-side and cannot be bypassed.
- **Archive order** (CLAUDE.md invariant): this change's deltas build on `chat-mirror` as modified by
  `wall-config-and-mirror-diagnostics` and `wall-text-formatting-and-mirror-policy`, and on the
  `text-formatting` spec that the latter introduces. Both must archive **before** this one.
