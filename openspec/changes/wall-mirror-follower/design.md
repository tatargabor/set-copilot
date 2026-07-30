## Context

The chat→wall mirror exists because a prompt mandate measurably fell behind in a live meeting: the
chat carried far more than the wall. The fix was to make delivery structural — a `Stop` hook
(`hooks/wall-mirror.sh`) that takes the turn's last assistant message, runs it through
`set-copilot mirror-policy --apply`, dedups, and emits it with `wall-emit … zone:"both"`.

That mechanism is right in its *reason* and wrong in its *shape*. The 2026-07-29 wall test produced
a first report of "the mirror silently stopped at 20:52:39"; re-measuring the artifacts **refuted
it** and found something worse:

- **One message behind, permanently.** `wall-events.jsonl`'s last write was 20:57:40 — the mirror was
  alive to the end. It delivered the message written at 20:57:02, while the message written at
  20:57:39.8, two tenths of a second before the hook ran, never appeared. `Stop` reads the transcript
  at turn end and races the final block's flush, so it delivers the last block it can *see*.
- **Late.** A line the operator read in chat waits for every tool call that follows it — seconds
  usually, minutes on a long turn.
- **Lossy.** `jq … | last` keeps one text block per turn. Everything said mid-turn is dropped, on a
  wall whose purpose is showing what the copilot is doing.
- **The closing summary is structurally unmirrorable** — it is written in the same turn that stops
  the wall.
- **Undiagnosable, which is why the first report was wrong.** No record is kept; the emit discards
  its error (`|| true`); and the dedup stamp is written *before* the emit, so a failed delivery is
  invisible and can never be retried. The policy was innocent — verified: `mirror-policy --apply`
  exits 0 on the "lost" message — but nothing on disk could have told anyone that.

One measurement reframes the length question too: that message is 2143 characters and the policy
returns **641** — item one of nine, cut mid-sentence. The cap is not protecting readability, it is
deleting the most valuable message of a session.

The enabling fact for the replacement is that the session transcript is appended **during** the
turn — verified on this session, whose assistant entries were on disk mid-turn. Each assistant
entry carries one content block (`text` / `thinking` / `tool_use`), a `uuid`, a `timestamp`, and an
`isSidechain` flag.

Constraints that shape everything below: the mirror policy has one implementation and must keep it;
redaction is server-side in `ingest` and must not be bypassable; a runtime dir has an owner and a
second owner is refused; and this is a *display convenience*, so it fails open (mirror with
defaults) where redaction fails closed.

## Goals / Non-Goals

**Goals:**

- Deliver each assistant text block to the wall as it is written, not at the turn boundary.
- Deliver *all* of them, in order, including mid-turn blocks.
- Make a stopped or suppressing mirror visible from outside the process.
- Keep formatting intact end-to-end, and stop teaching the copilot a policy that is not the one
  running.
- One mechanism, not two: the follower replaces the hook rather than racing it.

**Non-Goals:**

- Token-level streaming. The transcript records completed messages; the wall gets a block when the
  copilot finishes it. Stated in the contract, not papered over. The achievable reading of the
  operator's "texts and text *parts*" is per-block and per-chunk delivery (D7), and that is
  delivered; sub-message streaming would need a source the harness does not expose.
- Extending the text vocabulary beyond `heading`. Links, blockquotes, images and raw HTML stay
  literal, deliberately.
- Mirroring user messages, thinking blocks, or tool calls. Text blocks only, as today.
- Any change to the wall server, the event schema, `ingest`, redaction, or the renderer. The wall
  already renders the markdown subset; this change feeds it better, it does not extend it.
- A general-purpose Claude Code transcript API. The follower reads the fields it needs and
  tolerates the rest.

## Decisions

### D1. Replace the hook; do not run both

Two producers feeding one box means two implementations of one policy, free to disagree, plus
double lines whenever both fire. The hook's structural-enforcement property is *strengthened* by
the follower, which depends on neither the model nor a hook invocation, so keeping the hook as a
"backstop" would buy nothing and cost the duplication.

`init` therefore stops registering `wall-mirror.sh` **and removes a registration it previously
added** (an idempotent de-registration mirroring `registerStopHook`), and the script is deleted.
Leaving a stale registration behind would resurrect the double-emit on the next `init`-less
project. Note `hooks/recovery-guard.sh` is a different, unrelated `Stop` hook and stays.

*Alternative considered:* keep the hook as an end-of-turn sweep for anything the follower missed.
Rejected — "anything missed" is exactly what the offset already guarantees against, and the dedup
stamp only covers the immediately-previous message, so a sweep would double any earlier line.

### D2. Resolve the transcript by session id, with a glob fallback — no new hook

The hook received `transcript_path` in its payload; a standalone follower must find it. Resolution
order:

1. `--transcript <path>` when given (tests, and an escape hatch if the convention changes).
2. The convention: `~/.claude/projects/<cwd-with-slashes-as-dashes>/<session-id>.jsonl`.
3. A glob over `~/.claude/projects/*/<session-id>.jsonl` — which also survives a project being
   moved or the slug rule changing.

The session id comes from the runtime dir's own name (the `/ds`, `/dd` and `/meeting-copilot`
skills already scope it as `.set/copilot/$CLAUDE_CODE_SESSION_ID`), with `--session <id>` as an
override.

*Alternative considered:* a `SessionStart` hook that writes `transcript_path` into the runtime dir.
Rejected as the primary mechanism — it reintroduces the "did the hook fire?" question this change
exists to remove — but it remains the fallback if the path convention ever breaks, since the
resolution order above is a single function to extend.

### D3. Follow with `fs.watch` plus a safety poll, not `tail -F`

`fs.watch` (inotify) wakes on append with no polling cost; a 250 ms interval re-`stat`s as a
backstop for the cases inotify misses (some network and container filesystems). No `tail`
subprocess: this must run identically wherever Node runs, and a subprocess adds a second failure
mode with no benefit. Reads are incremental from the stored offset, and a partial trailing line is
kept in a buffer until its newline arrives — a JSONL append is not atomic with respect to a reader.

### D4. Offset advances after emit; dedup covers the overlap

At-least-once, never at-most-once: a repeated line is cosmetic, a dropped one is the failure this
change is fixing. A crash between emit and offset write re-delivers one message, which the existing
consecutive-identical dedup absorbs.

Two cases resume at **EOF** and log it, because replaying a session's history onto a live wall in
front of an audience is worse than losing the gap: a transcript shorter than the recorded offset
(truncation, rotation, a replaced file), and — found while first starting the follower against a
real in-progress session — **no recorded offset at all**. Mirroring gets enabled mid-session as
often as at the start, and a fresh follower reading from byte 0 would emit every earlier message of
the session at once. Those messages were not wall material when they were written; treating them as
wall material now because a follower appeared is the wrong reading of "never replays history".

These are the only two places this path deliberately drops content, and both say so in the log.

### D5. Filter to real assistant text: `type=="assistant"`, block `type=="text"`, `isSidechain` false

Subagent output lives in the same file with `isSidechain: true`. The old `| last` never noticed
because it took one block per turn; a follower that emitted every block would flood the wall with
every subagent's chatter. Thinking blocks and tool calls are excluded for the same reason they are
today — the mirror shows what the copilot *said*.

### D6. The policy stays where it is; the follower calls it in-process

`mirror-policy --apply` is a CLI wrapper over `applyCodeBlocks` + `isFillerMessage` + the caps. The
follower imports the same function the CLI does, so there is still one implementation — but it does
not pay a process spawn per message, which would put a fork on the latency path this change exists
to shorten. The CLI subcommand stays for compatibility and for anyone scripting it.

### D7. Length control divides the message; it does not delete the end of it

The wall renders a closed markdown subset, so a cut at character 600 mid-table produces debris: a
half table, or an unterminated fence that swallows the rest of the box. But block-aware *truncation*
only makes the deletion tidier — measured, the nine-item report still arrives as one or two items.

So the budget becomes a **chunk size**, not a ceiling: a long message is emitted as consecutive
mirror events, each carrying whole blocks, in order. The scrolling box accumulates them, which is
what it already does for the transcript stream. Only a single block that alone exceeds the budget is
cut, marked, and (if a code block) fence-closed.

This is also the honest answer to the operator's "szövegeket, szövegrészeket" — text *parts*. Token
streaming is not available (D-floor below), but a turn's parts now arrive as parts: per text block,
and for a long block per group of blocks.

*Alternative considered:* raise the cap to a few thousand characters. Rejected — it moves the cliff
instead of removing it, and one very long wall line is worse to read than several.

### D10. `heading` joins the closed text vocabulary

Verified: `parseWallText("## Fejlesztési igények")` yields a paragraph whose text still contains the
hashes, and `text-format.test.ts` asserts that literal degradation deliberately. That default is
right for a *producer-written* line; it is wrong for the mirror, whose input is a Claude Code message
whose sections are what make it scannable at wall distance.

Two ways to fix it, and the choice matters: normalize the heading to bold **in the follower**, or add
a `heading` block to the vocabulary. Normalizing puts a second, invisible rendering rule in the
producer path — the wall would still not know what a heading is, and two paths would disagree about
what a `##` means. So the vocabulary gains `heading`, as a deliberate engine change (the same
category as extending `RenderType`), and `text-format.test.ts`'s literal-degradation case for `#`
moves out of that list, because that test encodes the intent being changed.

Nothing about the payload changes: formatting is still derived at render time from a plain string, so
`ingest`, redaction and replay are untouched.

### D11. The delivery path fences monospace-dependent content itself

The field test's ASCII table arrived unfenced and rendered proportional. The reason it was unfenced
is instructive: the copilot was avoiding a code-block stripping that the config no longer performs.
Fixing that by *teaching the copilot to fence* would replace one piece of prompt discipline with
another — in a change whose entire premise is that display delivery must not depend on the model
remembering.

So the follower detects a block whose readability depends on alignment (box-drawing characters, or
consistent column positions across three or more lines) and fences it before emit. Already-fenced
content is left alone; prose, lists and markdown tables are never fenced. The rule is mechanical and
unit-testable, which is the point — a heuristic that runs every time beats an instruction that runs
when remembered.

### D12. Delivery is confirmed before the offset or the stamp moves

The hook wrote its dedup stamp *before* emitting and emitted with `|| true`. That is the worst
possible ordering: a failed emit is invisible **and** permanently deduped, so the message can never
be retried — the stamp claims it already went out. The follower advances the offset and the stamp
only after a successful emit, logs a failure with its error, and retries. Combined with D4's
at-least-once ordering, the failure mode is a duplicate line, which the dedup absorbs.

### D13. `stop` drains before the wall goes down

The closing summary is produced in the same turn that stops the wall, so no mirror path can ever see
it while the wall is up. `stop` therefore drains the follower — deliver what the transcript already
holds — *then* stops the wall, and reports what it could not deliver instead of exiting silently.
This is the same posture as the transcript hand-over: the last thing produced is the most valuable,
so it gets an explicit step rather than best-effort timing.

### D8. The contract is rendered from the resolved policy

`copilot-prompt.ts` gains a mirror block derived from the resolved `copilot.mirror` (kept vs
stripped code blocks, the caps, the category), and `skills/meeting-copilot/SKILL.md` stops
restating it. The stale sentence at `SKILL.md:32` ("strips code blocks, skips short filler
(<40 chars)") is the direct cause of the unreadable ASCII table: the copilot avoided a fence to
survive a stripping that stopped happening when the default became `keep`, and lost monospace
rendering in the process. Same seam, same reason as `copilot.alerts` and `copilot.drawing` — a
restated policy rots, a rendered one cannot.

### D9. The log is the deliverable, not a debug aid

`wall-mirror.log` records one line per considered message: timestamp, message uuid, decision
(`emit` / `filler` / `short` / `dup` / `truncated` / `error`), and byte offset. Bounded by
line count with rotation to `wall-mirror-<ts>.log`, following the wall event log's
rotate-never-truncate rule. `doctor --mirror` answers four states — wall running, opt-in marker,
follower alive, last emission time — because the field failure was undiagnosable precisely for the
lack of those four answers.

## Risks / Trade-offs

- **The transcript path convention is harness-internal and could change** → three-step resolution
  (explicit flag → convention → glob by session id), a loud error naming `--transcript` when all
  three fail, and D2's `SessionStart` fallback held in reserve.
- **Compaction may start a new session file** → the glob resolves by session id, and a resumed
  session with a new id gets a new runtime dir anyway (the skills scope by id). Worst case the
  follower reports "transcript not found" instead of going quiet.
- **Every text block now goes to the wall, not one per turn — the wall gets noisier** → this is
  wanted (the operator asked for more narration, and the wall's purpose is showing the work), and
  the filler policy plus the minimum length remain the throttle. If it proves too much, the knob is
  config, not code.
- **Chunking multiplies that: one long message becomes several wall lines** → chunks carry whole
  blocks and stay in order, so the box reads as one message continued, not as fragments. The
  alternative was measured and is worse: eight ninths of the message deleted.
- **The alignment heuristic could fence something that is not a table** → it requires either
  box-drawing characters or column alignment across three or more lines, an unnecessary fence is
  cosmetic (monospace prose), and it is pure and unit-tested. The failure it prevents — an
  unreadable table in front of a room — is the asymmetry that justifies the bias.
- **An orphaned follower keeps emitting after a session ends** → PID ownership with refusal, `stop`
  terminates it, and the runtime-repair path reports an orphan, exactly as for `capture.pid`.
- **A busy transcript could emit faster than the wall renders** → messages are inherently
  turn-paced (a model writes a handful per minute); no batching is added, and the scroll ring
  already bounds what a box holds.
- **Losing the hook loses the one path that worked without a running process** → mitigated by
  making absence loud: the opt-in refuses to record success without a live follower, and the
  diagnostic reports it. A mirror that says it is off is strictly better than one that pretends.

## Migration Plan

1. Land the follower and its lifecycle; keep the hook script in place but stop registering it.
2. `init` de-registers the mirror hook on its next run in an existing project (idempotent, touches
   only that one entry, leaves `recovery-guard` alone).
3. Delete `hooks/wall-mirror.sh` once the de-registration ships, so a project that never re-runs
   `init` degrades to "hook present but script gone" — a loud failure, not a silent double emit.
4. No config migration: `copilot.mirror` keeps its shape and defaults.

**Rollback**: re-register the hook and stop starting the follower — the policy, the marker, the
category and the emit path are unchanged, so the two mechanisms are swappable at the registration.

## Open Questions

- Should the follower also mirror a **subagent's** final report when the operator explicitly runs
  one (`isSidechain: true`)? Excluded here as noise; revisit if the wall looks empty during long
  delegated work.
- Does `wall-mirror.enabled` remain the right opt-in marker once the follower's own PID file
  signals intent? Keeping both for now: the marker is the *decision*, the PID is the *fact*.
