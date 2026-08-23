# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build            # tsc → dist/ (bin + exports point at dist, so build before testing the CLI)
npm run dev -- <args>    # run the CLI from TypeScript source, e.g. npm run dev -- doctor
npm test                 # vitest run
npx vitest run src/config.test.ts       # a single file
npx vitest run -t "flushes on a sentence"  # a single test by name
```

There is no linter. `tsc` runs in `strict` mode and is the only static check.

Tests cover the pure logic only (config resolution, keyword matching, source globbing, transcript flush rules, prompt rendering) — everything that does not need a microphone. Anything touching audio, Soniox, or the PID lifecycle is verified by running the CLI.

`set-copilot doctor` is the fastest way to verify a change end-to-end: it probes the real audio chain (binary → device → bytes → signal level) rather than guessing, and reports whether Soniox credentials resolve.

## OpenSpec workflow

Spec-driven changes live in `openspec/changes/`; the applied source of truth is `openspec/specs/`. Drive this work through the **`/opsx:*` skills** (`/opsx:propose`, `/opsx:apply`, `/opsx:archive`, `/opsx:continue`, `/opsx:status`), **not** the raw `openspec` CLI by hand — the skills enforce the workflow (context-file reads, status/artifact ordering, sync-then-archive). The bare CLI is fine only for quick read-only inspection.

**Commit at each step.** An `/opsx:apply` (implementation) and an `/opsx:archive` (spec sync + move) are each a commit-worthy unit — commit after each rather than batching many changes into one. Doing it after the fact is fine when a run got ahead of its commits, but the default is one commit per apply and one per archive.

Two archive-time invariants, each learned from a real abort:

1. **Archive in dependency order.** A change that `## MODIFIED`s a requirement can only archive *after* the change that `## ADDED` it — the base spec must exist first. If an archive fails with "target spec does not exist", archive the originating change first.
2. **A MODIFIED requirement must carry forward every base scenario.** The archiver refuses to silently drop a scenario. If a scenario is genuinely obsolete, don't just delete it — reframe it to its surviving intent or move it under a `## REMOVED` requirement. And a delta that removes *every* requirement from a spec leaves it empty (invalid): retire the capability with a single tombstone `## ADDED` requirement that redirects to its successor, so the audit trail and the removal reasons survive.

## Architecture

A CLI + library that captures audio, streams it to Soniox for speech-to-text, and writes sentence-level JSONL that a **Claude Code session** reads. There is no server and no second AI: the "copilot intelligence" is the Claude Code session running the skills in `skills/`.

The data flow crosses a process boundary, and that boundary is the thing to keep in mind when changing anything:

```
set-copilot capture (background process)  →  <runtimeDir>/transcript.jsonl (or dictation.jsonl)
                                          ↑
Claude Code session  ←  set-copilot poll (long-poll)  ←┘
```

- **`src/audio.ts`** — spawns `parec` (Linux) / `sox` (macOS) and hands back raw 16 kHz s16le mono streams. Prefers `/usr/bin/parec` over a PATH-shadowing Homebrew build, which hangs silently against PipeWire.
- **`src/soniox-rt.ts`** — `SonioxRtClient` (WebSocket, `stt-rt-v5`, default) and `SonioxChunkClient` (10s chunked async fallback, `sonioxMode: "chunk"`). Both emit the same `TranscriptEvent`.
- **`src/transcript-writer.ts`** — buffers final tokens per speaker and flushes a JSONL line on sentence boundary, that speaker's own 3s silence, or 80-token overflow. Annotates each line with `topics` (keyword matches), `urgency`, `question`. Also emits one `{"type":"silence"}` event per silence period. Note: Soniox v5 tokens carry their own leading spaces — concatenate, never join with spaces.

  **A speaker change must never flush the other channel.** It did until 2026-07-26, on a "natural turn-taking" assumption that only holds for a *single diarized* stream. The two channels are independent: speech genuinely overlaps, and the constant backchannel ("mhm", "aha") on one channel cut the other's sentence wherever the token stream happened to stand — i.e. mid-word. Measured on a 3-hour two-channel recording: **460 mid-word cuts**, 44% immediately after a cross-channel interjection. Dictation (`--mic-only`) never showed it because the system client is not even constructed, which is why it stayed hidden.

  Three fields exist so a reader can rebuild what the flush boundaries destroyed — a consumer that ignores them gets the old, lossy reading:
  - `startTs` — the utterance's **start** (`ts` is where it ended). With two channels, completion order is not speaking order; sort on `startTs`.
  - `partial` — this line was cut without a sentence boundary; the thought continues in that speaker's next line.
  - `cont` / `midWord` on the resuming line — `midWord` means the two lines' adjoining words are halves of **one** word (join with no separator); `cont` alone takes a space. Soniox's leading space is the only evidence of a word boundary and `flushBuffer` trims it, so the fact is recorded at token time or it is gone for good.
- **`src/transcript-build.ts`** — the stitch: the *consumer* side of those three fields, and the
  only thing that reads them. It reverses the flush boundaries — rebuild each channel on its own
  (its fragments are complete *within* the channel; only the interleaving destroyed readability),
  split *that* into sentences, then merge the finished sentences on `startTs`. Emits a readable
  `.md` and a sentence-level `.jsonl`. `src/transcript-stitch-run.ts` is the file-facing half
  (input resolution, artifact writing); `transcript-build.ts` stays pure and unit-tested.

  Word boundaries: `cont`/`midWord` are the **authority** when present. Only a pre-`a30d12f`
  recording reaches the heuristic, which is biased toward inserting a space — an unnecessary space
  is cosmetic, a wrongly glued pair destroys two words — and `--stats` reports how many boundaries
  it had to guess (0 on any post-fix input). Ordering ties are broken by **file order** (`seq`),
  never by kind: a `reconnect` event's `ts` is the last speech *before* it, so it always ties with
  the line it followed, and ranking events first prints every break one turn early.

  `stop` runs it on the **archived** file, after the rename — the `renameSync` stays the sole
  source of truth for "handed over exactly once", and a stitch failure is reported, never fatal.
  The `--print` (dictation) path produces nothing derived — no `.md`, no `-stitched.jsonl` —
  because there the text is the user's **message**, not a document. But it *is* stitched
  (`dictation-stitched-output`): the distinction that matters is artifacts vs. text, and
  conflating the two once left the worse half of the problem in place. `dd/SKILL.md` used to
  say "concatenate the `text` fields", which asks a consumer to supply a separator it cannot
  know — `cont` without `midWord` means a space, `cont` with it means none — so a real
  dictation reached the model as `…a ide, ameetingek…`. A meeting transcript is read later by
  someone who can go back to the recording; a dictation is an *instruction*, corrupted before
  the model reads it, with no second chance. `renderPlain` is a third renderer over the same
  sentence stream (never a second reassembly path), emitting sentences and nothing else —
  `renderMarkdown`'s `**[00:00:11] mic:**` prefixes are meeting furniture that would arrive as
  part of the instruction.

  **This path fails OPEN, and that is deliberate.** If the stitch throws or yields nothing
  from a transcript that is not purely non-speech events, the raw contents are printed and the
  reason goes to stderr. It is the exact inverse of `wall.redaction`'s fail-closed rule, and
  the difference is the direction of harm: on a public wall a mistake *publishes* something,
  so withholding is safe; here a mistake would *swallow what the user just said*, and they
  have no copy. A badly joined word boundary is visible and recoverable; a vanished dictation
  is not. Note `printTranscriptOnce` is exported from the library, so its output shape is
  public — an external caller that parsed it as JSONL wants the archived file instead.
- **`src/recovery-ledger.ts`** — migration semantics for recovery. The valuable step is a model
  *reading* a whole meeting to find what was said that never reached the notes, so it must run
  **once per transcript, ever**. Two decisions carry that:

  **The record is engine-owned, not prompt-owned.** `stitchFile` appends its own entry; the
  caller cannot forget to. A skill told to "remember you already reviewed this" eventually will
  not, and this repo already paid for that lesson once — the chat→wall mirror began as a prompt
  mandate, measurably fell behind in a live meeting, and became a mechanism (a `Stop` hook first,
  then `mirror-follow`; see the mirror section below for why the hook was not enough). A review is worse
  than a mirror line: forgetting means re-reading a whole meeting, or losing the knowledge twice
  if a stale status is believed. So `recovery mark` is not bookkeeping *after* the work — it is
  how findings are **delivered** (`--findings-file`), and there is deliberately no path that
  produces findings without writing the record. `hooks/recovery-guard.sh` closes the rest: an
  open claim blocks the turn (exit 2, stderr fed back — the verified Stop contract). It **never**
  marks a review complete on the caller's behalf; asserting a review that did not happen is the
  one failure that loses knowledge silently. The Stop input carries no `stop_hook_active`, so
  re-entrance is bounded by a nudge counter — three blocks, then the turn ends loudly with the
  claim still dangling.

  **Identity is a content fingerprint, never a path.** The handover renames every file it
  archives and recordings get copied between repos. SHA-256 also answers the awkward cases for
  free: two copies are one transcript, edited content is a new one. The stitch **version** is
  recorded but never triggers a redo — the algorithm changed twice in one session, and
  redo-when-stale would turn a patch release into an unbounded model-pass bill across every
  archive. Staleness is *reported*; `--force` is the operator's. A claim is its own state,
  distinct from both pending and done, because "started and not finished" is information.

  The ledger is advisory by construction: missing → everything pending, a corrupt line skipped,
  the artifacts on disk are the real evidence. Losing it costs redone work, never data.
- **`src/capture.ts`** — wires the above together; also owns the runtime-dir invariants (below).
- **`src/fast-lane.ts`** — the spoken command lane. Everything else the copilot does is
  inference, and inference is deliberately gated (silence, dwell, a whole model turn):
  measured end to end, a reaction lands ~33 s after the sentence that warranted it. An
  *instruction* needs none of that judgement, so it pays none of that cost — a bracketed
  command (`COPILOT … CSINÁLD`, `START … STOP`) becomes a `{"type":"command"}` event that
  `poll` returns on at its next 250 ms tick.

  Three things carry it, each forced by how speech actually arrives:

  - **It reads the token stream, not the written lines.** A line is a flush artefact
    (sentence punctuation, that speaker's 3 s silence, 80 tokens) and none of those rules
    know where an instruction starts. A marker split by a flush — `"CSI"` | `"NÁLD"` — is
    invisible to any line-level matcher, so the lane keeps its own rolling buffer per
    speaker that no flush touches. Verified: `" Copi"`, `"lot"` opens a command.
  - **The closing word is load-bearing, not ceremony.** Speech has no reliable
    end-of-thought: the recogniser's punctuation is a guess and a speaker who pauses
    mid-instruction has not finished. Without a terminator the engine would have to guess
    when to execute, and the failure mode is acting on half a sentence. It also makes the
    trigger deliberate — one marker can be said by accident, both in order much less so.
  - **An unterminated span dies out loud** (`{"type":"command-abandoned"}`), on a time or
    length cap. A command that quietly never happened is indistinguishable from one the
    microphone never heard, and the operator would go debug their audio chain. It is also
    what stops the next twenty minutes of speech from silently becoming "the instruction".

  The vocabulary is config (`copilot.fastLane`), the mechanism is engine — the `detect.*`
  seam again. Matching is accent- and case-insensitive over Unicode letters and whole-word
  only (`restart` never opens one); the extracted instruction keeps the speaker's own text.
  A note on the shipped defaults: `copilot` is a word nobody says mid-meeting, while
  `start`/`stop` are ordinary speech — both bracket styles ship because both were asked
  for, and a project whose meetings say them should drop them in config. Requiring both
  words in order is what keeps the risk to a stray pair. The command's words also remain in
  the ordinary transcript line (the transcript is a record; editing it would be a lie), so
  the policy tells the copilot to act on the *event*, never on the line — otherwise one
  instruction is carried out twice.
- **`src/poll.ts`** — long-poll consumed by the meeting-copilot Monitor loop. Tracks a byte-independent line offset in `poll-offset`, dedups mic/system echo, returns early on an urgent/question/silence event, and emits `{"type":"capture-dead"}` when the capture PID is gone.
- **`src/mirror-follow.ts` / `mirror-policy.ts` / `mirror-format.ts`** — the chat→wall mirror.
  `mirror-follow` is the process (transcript resolution, offset, PID ownership, the log);
  `mirror-policy` is the one implementation of the content judgement, called in-process by the
  follower and wrapped by the `mirror-policy` CLI subcommand; `mirror-format` is the pure
  block/fence/chunk layer. See "The chat→wall mirror is a follower, not a hook" below —
  including why the original field diagnosis of it was wrong.
- **`src/config.ts`** — resolution order (later wins): defaults → `~/.config/set-copilot/set-copilot.config.json` → project `set-copilot.config.json` → env (`SET_COPILOT_DIR`, `MIC_SOURCE`, `SONIOX_MODE`, …). Nested sections merge key by key. `SONIOX_API_KEY` comes only from env / project `.env` / user `.env` — never the committed config.
- **`src/copilot-prompt.ts`** — renders `copilot.alerts` + `copilot.instructions` into the policy markdown that `set-copilot prompt` prints and the skill loads at session start.
- **`src/knowledge/`** — the knowledge-adapter layer. `run-digest.ts` resolves `knowledge.adapter` ("markdown" built-in, or a path to a module default-exporting a `(ctx) => KnowledgeAdapter` factory) and writes three artifacts into the runtime dir: `keyword-index.json`, `knowledge-context.json`, `knowledge-digest.md`. Capture reads the keyword index; the skills read the other two. `sources.ts` resolves `knowledge.sources` (dirs, files, globs) with a small dependency-free glob.

- **`src/wall/`** — the monitor wall: a local HTTP+SSE server (`server.ts`) rendering a category-tagged event stream that producers append to `<runtimeDir>/wall-events.jsonl` via `wall-emit` (`emit.ts`). The producer is a *fork* of the main session, not a second model.

### The wall's display model: window → layout → box position → box

Three layers, deliberately separate — collapsing them is what the `wall-layout-and-box-policy` change undid:

- A **layout** (`wall.layouts`) is geometry only: named box positions and their grid arrangement. `layout.ts` resolves a window against it; `wall-core.mjs` derives the CSS Grid template. There is no fixed column count — `stacked` and `third-two-thirds` are both just config, and a window is reshaped by swapping an id.
- A **box** (`window.boxes`) is content only: `behavior`, `pacing`, category subscriptions, and an optional `policy`. Moving a box to another position must not change how it behaves.
- The **renderer follows the event's payload**, not the box or the category. `render` on a category is only a default. That is what lets one presentation box hold a graph, then a chart, then an image. The vocabulary (`text`/`graph`/`chart`/`image`/`webpage`) is closed in `RenderType`: extending it is an engine change, never a config one.

A window's legacy `slots` list still resolves (onto `stacked`), so an old config keeps working and keeps looking the same.

**A viewport override is a fourth thing, deliberately below all three** (`wall-viewport-and-activity`). Dragging a splitter adjusts the *track sizes this viewer renders with* — nothing else. It never reaches the server, never touches config, and is keyed to the layout it was made against, so a runtime layout switch renders the incoming layout's declared proportions rather than a translation onto tracks that no longer mean the same thing. `applyViewportOverride` is pure and takes a **template**, not a window: it structurally cannot reach a box, which is how "geometry only" stays a fact rather than a promise. Per viewer, not shared, because the operator's laptop and the projected wall are different shapes — and because one viewer's drag must never re-proportion a wall in front of an audience. A track is clamped to `MIN_TRACK_SHARE` of its axis: a region dragged to zero takes its content *and its own drag handle* with it.

The graph's fit is the same posture pointed at scale: automatic until the viewer sets one, then theirs until they explicitly hand it back, and per *visual* so a `reset` (new topic) starts fitted instead of inheriting a scale chosen for the previous diagram. The self-driven guard is a **deadline**, not a flag — an animated layout keeps emitting `zoom` for its whole duration, and a flag released on the next frame made every automatic fit look like the viewer taking control.

**Audience and zone are different axes** (`wall-public-surface`). `zones` is what a window *may display*; `audience: "public" | "operator"` is whether a live audience is *looking at it*. The audience is the pivot for every public-zone protection — which redacted variant is broadcast, which accumulation slice is replayed, whether a `stage-expired` is delivered, how a `show` is zoned — and it used to be **inferred** as `!zones.includes("private")`. That inference made "show more on the public wall" and "turn redaction off" the same edit: widening a public window's zones silently disabled redaction in front of a room. `isPublicClient` is now a single accessor over the declaration, written as `!== "operator"` so an undeclared window still gets the protected reading; do not re-derive it from zones for convenience, and note the fail-closed default is unit-tested by name in `audience.test.ts` so re-inferring breaks a test that says why.

Consequences worth keeping straight:

- **An undeclared or unreadable audience resolves to `"public"`** — redaction on, private events withheld — with a warning naming the window and the one-field fix. This inverts the old default on purpose: a wall that redacted what it needn't is an annoyance, one that failed to redact is what this exists to prevent. Both shipped windows declare explicitly (`én` → `operator`, `fal` → `public`), so a default install is unchanged; a *project* config predating the field becomes strictly more redacted and says so.
- **A disagreement resolves toward the protected reading**, warned — `"operator"` on a window with no `private` zone is far more likely a mislabelled public wall than a deliberate setup.
- **A public surface never receives a `private` event, whatever its zone filter admits.** Enforced in `payloadFor` for the display event *and* for `show`/`pending` (both name what is being drawn), not left to the zone filter — leaving it to the filter is precisely what broke. `zone: "private"` stays the only reliable content gate; `audience` is a display fact, not access control.
- **To show more publicly, add a box** and have the producer emit that content to a shared zone. Widening `zones` is not the mechanism, and parity is the same *boxes*, not the same *feed*: a public mirror box shows what was emitted to a shared zone and survived redaction. Two ready configs in `docs/wall-public-parity.md`.

**Public-zone redaction** (`redaction.ts`) runs server-side in the shared `ingest` funnel, before any broadcast or accumulation — a producer-side filter fails open, and the JSONL tailer bypasses the CLI, so this is the only place that catches every producer. It is the highest-stakes code in the project: a mistake puts internal data on a public wall in front of a live audience, so the whole design is *fail-closed* — when in doubt, withhold, don't scrub. The shape it has was forced by four adversarial verifiers reproducing leaks through an earlier field-list version:

- **Recursive, not a field list.** The payload is open (`GraphNode`/`ChartDatum` carry `[k: string]: unknown`), so the redactor walks every string leaf at any depth under any key. A list can never be complete; a walk is closed to future keys too.
- **A matching URL (`image.src`/`webpage.url`) withholds the whole event**, never scrubs — a token in a URL can't be removed while leaving the link usable.
- **Per-delta zone in accumulation.** A visual's deltas accumulate into separate private/public slices; a public join replays from the public slice, which never received the private deltas. This is what closed the replay-laundering leak — do not collapse it back to one zone per visual.
- **The `show` command is zoned** to where its visual lives, because a `visual` id is free producer text and can itself be sensitive.
- **Bounded evaluation (ReDoS).** Two structural limits at config-load — no repeated group (`)` followed by `*`/`+`/`{`, which kills the exponential class outright) and at most 2 unbounded quantifiers (which caps polynomial backtracking at quadratic) — plus a per-leaf length cap that bounds that quadratic. Rejecting *classes* structurally, not guessing *which* patterns are dangerous: three adversarial rounds proved the guess-the-danger approach is walkable. Patterns are config-only (never a producer or the transcript), so this bounds an operator footgun; re2 is the localized swap for a hard linear guarantee.

Two rules deliberately break the wall's usual "drop it with a warning and carry on" posture, because here a mistake is *published* rather than logged: a redaction failure (compile error, timeout, unexpected shape) **withholds** the event from the public zone, and an uncompilable or catastrophic pattern is dropped loudly at load. It is a shape-matcher, not a classifier and not a security boundary — `zone: "private"` remains the only reliable way to keep something off the public wall. The private view marks (a corner badge / line style) what the public wall did not get, so a silent redaction is never mistaken for one that did not run.

**Prepared, not published** (`predictive-staging`) is the same zone model turned toward latency, not confidentiality. A fork-based draw is slow (16–62s), so the copilot uses a `silence` window to pre-draw the *likely-next* visual — a guess — into the private staging box (`zone:"private"`, `staged:true`). A guess must never gain the wall's authority before it is spoken, so a prediction **never** reaches a public client autonomously: there is no confidence threshold, only the zone gate. When the conversation actually arrives, a cheap `promote` (a server-side zone-lift of the already-drawn visual, re-run through `ingest` so redaction applies — never a re-draw) lifts it public on an explicit human/rule gate. An unpromoted prediction **expires** (the server drops it from the promotable registry and marks the private view), so a stale guess neither lingers as noise nor publishes later out of context. The load-bearing invariant — *an unspoken prediction never reaches a public client automatically* — is the zone model, not a new mechanism.

Two things that mechanism needed and did not have, both found by measuring rather than reading (`prediction-promotion-contract`):

- **The contract described staging and never documented the promote command.** `set-copilot prompt` said only a promotion lifts a visual public, then listed every payload shape *except* that one. Across four real-time replay runs the copilot staged 2, 3, 2 and 7 predictions and promoted **0, 0, 0 and 1** — the choreography's second half was unreachable because it was never taught. The command's shape now lives in the payload-shapes block next to the others, together with the fact that a staged visual must carry a `visual` id (the promotion names it) and the trigger: the conversation *arriving* at what the prediction anticipated. When to promote is judgement, so it is a `copilot.drawing` convention; the wire shape is mechanics, so it is engine.
- **The producer had to remember what it staged.** The registry is server-side and in-memory, so nothing could be asked. `wall-staged` (over a read-only `/api/staged`) answers it — the same move this project already made when the chat→wall mirror's prompt-held memory drifted in a live meeting. Read-only is load-bearing and tested by name: a query that quietly extended a prediction's life would make "expired" mean "expired unless someone looked".

Writing the listing exposed a real gap in the gate itself. `promote` tested map *presence*, while the listing filtered by the *clock* — so between two sweep ticks (5 s by default) a prediction past its ttl was invisible to the listing and still promotable, which is exactly the "an unspoken guess publishes late and out of context" failure the ttl exists to prevent. The gate now decides on the clock and retires the entry it finds stale, so the sweep's private marker still goes out exactly once.

### Everything project-specific is config, not code

This package was extracted from one ERP project, and the recurring failure mode is that project leaking back into the engine. Six seams exist to prevent it — when a behavior feels domain-specific, it belongs behind one of them, not in a regex in `src/`:

- **`copilot.alerts`** — the alert taxonomy (⚠ contradiction / 📋 context / ✏ new decision / ❓ question) is *data with defaults in `config.ts`*, not prose in the skill. `SKILL.md` owns the mechanics; the policy comes from `set-copilot prompt`. Adding a category must never mean editing the skill.
- **`detect.urgency` / `detect.question`** — the regexes behind the per-line flags. Defaults cover English + Hungarian; anything else is configured, and a user-supplied bad regex is dropped with a warning rather than killing the capture.
- **`knowledge.keywords` + `autoKeywords`** — a flat `[{topic, stems}]` list (named groups are flattened for back-compat), with topics auto-derived from page titles, `##` headings, and frontmatter tags.
- **`copilot.drawing` (the drawing contract)** — the knowledge a producer fork needs to draw the wall: the category-registry summary, the `wall-emit` payload shapes, the render types, and the when-to-graph/chart/text conventions. Like `copilot.alerts`, it is *data with defaults in `config.ts`*, rendered into `set-copilot prompt` as its own block — so a project can rename its categories or reshape what gets drawn without forking the skill. It lives in the base context (loaded once, cache-warm) precisely because every draw needs it; the per-draw fork prompt stays a one-line mandate.
- **`transcript.completeWords` (+ `speakers`, `pauseGapMs`, `stitchOnStop`)** — the stitch's
  heuristic dictionary is a *language* fact, not an engine one. The reference implementation
  carried a hardcoded Hungarian function-word list; shipping that in `src/` would be exactly this
  failure mode, so it is config with HU+EN defaults, like `detect.*`. An **empty** list is honoured
  as a deliberate "never guess" (every unmarked join takes a space — lossless, just less pretty);
  only an absent or malformed key falls back. Note this is the *opposite* posture from
  `wall.redaction`, where an empty list must never mean "publish everything" — nothing leaks here,
  so "no rules" is a safe answer.
- **`wall.redaction`** — the public-zone redaction *taxonomy* (patterns, replacement, the `[belső]`/`[internal]` marking convention, the input-length cap). The *mechanism* (recursive walk, URL withholding, fail-closed, ReDoS bound, per-delta replay zoning) is engine, in `redaction.ts`; only the taxonomy is config. The shipped default is domain-neutral — it matches a marking convention, not any project's names — so a fresh project never silently redacts, or fails to redact, against another project's vocabulary. The convention the default relies on is taught to the producer in the drawing contract, not left as a phantom.

Word boundaries are Unicode (`\p{L}\p{N}`), never `\b` or an enumerated Latin+Hungarian character class — `\b` treats `á` as a boundary and silently breaks every accented language.

### The chat→wall mirror is a follower, not a hook

`set-copilot mirror-follow` watches the Claude Code session transcript and emits every new
assistant text block to the wall as it is written. It replaced a `Stop` hook on 2026-07-29, and
the reason matters more than the mechanism, because the *first* diagnosis was wrong:

The field report said "the mirror silently stopped at 20:52:39". Re-measuring the artifacts
refuted it — `wall-events.jsonl`'s last write was **20:57:40**, the mirror was alive to the end,
and the message it never delivered passed the policy cleanly (`mirror-policy --apply` exits 0 on
it). What the timestamps show is worse than a stop: the hook was permanently **one message
behind**. It fired at turn end and read the transcript *then*, racing the final block's flush
(0.2 s decided it), and `jq … | last` kept one block per turn, so everything said mid-turn was
discarded. A session's closing summary could never be mirrored at all — it is written in the same
turn that stops the wall.

So: don't reason about this path from the old report, and don't reintroduce a turn-boundary
trigger. Four invariants carry the replacement, each from a defect in what it replaced:

- **Delivery is confirmed before it is forgotten.** The hook wrote its dedup stamp *before*
  emitting and emitted with `|| true` — a failed emit was invisible **and** permanently
  de-duplicated, so it could never be retried. `mirror-offset` and `wall-mirror.last` advance
  only after `emitWallEvents` reports success; a failed pass leaves both untouched and the next
  pass retries. At-least-once, absorbed by the dedup — a repeat is cosmetic, a loss is the bug.
- **Length control divides a message; it never deletes the end of it.** Measured: a
  2143-character nine-item report reached the wall as 641 characters, item one of nine. So
  `copilot.mirror.maxLength` is a **chunk budget** — a long message goes out as consecutive
  events on block boundaries (`mirror-format.ts`), and the scrolling box accumulates them. A
  boundary never lands inside a table or a fence, because half a table renders as debris and an
  unterminated fence swallows the rest of the box.
- **Formatting is applied by the delivery path, not asked of the model.** An ASCII table reached
  the wall unfenced and rendered proportional, because the copilot was avoiding a code-block
  stripping the config no longer performed. `fenceAlignedBlocks` fences box-drawing and
  column-aligned blocks mechanically. Same reasoning added `heading` to the wall's closed text
  vocabulary: a mirrored Claude Code message is heading-structured, and normalizing headings to
  bold in the producer would have left the wall not knowing what a heading is.
- **Every decision is recorded.** `wall-mirror.log` says, per message, `emit`/`filler`/`short`/
  `dup`/`error`/`reset`; `doctor --mirror` answers follower-alive, marker, wall, and last
  emission. The field failure was undiagnosable for want of exactly those answers — which is
  also why `doctor --mirror` still looks for a leftover `wall-mirror.sh` registration: next to
  the follower it would double every line, invisibly from the wall.

One thing no mechanism can fix, so the skill owns it: **write the closing summary before stopping.**
`stop` and `wall-stop` each drain the follower first, so anything already written gets out — but a
summary written after the wall is down has nothing to reach.

### Runtime-dir invariants

A capture **owns** its runtime dir (transcript + `capture.pid` + `capture.output` + `poll-offset`). The `/ds` and `/dd` skills scope it per Claude session via `SET_COPILOT_DIR="$PWD/.set/copilot/$CLAUDE_CODE_SESSION_ID"`, and `stop` finds the capture *through that directory* — so any change that touches the path must keep `capture` and `stop` byte-identical.

Two rules are load-bearing and were each fixed after a real failure; don't regress them:

0. **The mirror follower owns `mirror.pid` + `mirror-offset`** in the same dir, under the same
   rules: a second follower is refused while one is live, a stale PID file is reclaimed, `stop`
   stops it, and `set-repair` reports an orphan. A transcript shorter than `mirror-offset`
   (truncated, rotated, replaced) resumes at **EOF** and logs the discontinuity — the one place
   this path deliberately drops content, because replaying a session's history onto a live wall
   in front of an audience is worse than losing the gap.
1. **A transcript is handed over exactly once.** `stop --print` prints, then renames the file to `<name>-<timestamp>.jsonl`. Without the archive step a double `/dd` replays the previous dictation as if freshly spoken and Claude acts on it twice. `capture` likewise archives (never truncates) an unconsumed transcript it finds.
2. **A second capture in the same runtime dir is refused** while one is live. Overwriting the PID file would orphan the first process — still recording, nothing able to stop it.
3. **The wall event log is rotated, never truncated.** `wall-events.jsonl` is the canonical rebuild source for the accumulated state (graphs, pinned latest, and the scroll rings replayed to a reloading window). `wall --reset` archives it to `wall-events-<timestamp>.jsonl` — mirroring the transcript hand-over — and only *after* the live-wall check, so a running wall's log is never rotated out from under it. During a live session don't truncate the log or restart mid-session; a fresh run either uses a new scoped runtime dir or this deliberate `--reset`.

### Skills

`skills/{ds,dd,dictate,meeting-copilot,transcript-recover,set-repair}/SKILL.md` are shipped in the npm package and installed by `set-copilot init` into `.claude/skills/` (or `~/.claude/skills/` with `--global`). They are *prompts*, not code: they invoke the CLI and define how Claude reacts to transcript batches. Mechanics (the poll loop, the output shape, the phase order) belong in `meeting-copilot/SKILL.md`; *judgement* (what is worth speaking up about) belongs in `copilot.alerts` / `copilot.instructions` so a project can change it without forking the skill.

**From a checkout, `init` symlinks; from an npm install it copies** (`skill-install.ts`, decided by `PKG_ROOT/.git`). So when you are working in this repo, the file under `~/.claude/skills/` **is** the file in `skills/` — editing "the installed copy" edits the repo, and an edit here takes effect in the next session with no re-install. That is the point: it copied until 2026-08-09, and a copy taken from a directory that keeps moving is a snapshot nothing refreshes and nothing reports. Measured that day, on this machine, with the package `npm link`ed at this very checkout: the installed `meeting-copilot/SKILL.md` was 16 437 B against a 31 107 B source — **~15 KB, the whole mirror section, that had never reached a session** — `set-repair` and `transcript-recover` had never been installed at all while init's message named all six, and `dd`/`dictate` still carried the "concatenate the `text` fields" instruction this file documents as the *cause* of dictation corruption. Every `/dd` that day ran the known-broken instruction.

Three rules the installer follows, each from that measurement: it **declares** which mode it used (silence about it produces the same failure in the opposite direction — "why is my fix not taking effect?"), it never creates or keeps a **dangling** link (the skill then vanishes from the list with no error at any layer), and it **archives** an existing real directory to `<name>.bak-<timestamp>` rather than deleting it, with the backup's `SKILL.md` renamed so the archive cannot shadow the install. And note a same-named skill in `~/.claude/skills/` **shadows** the project's `.claude/skills/` one, so patching a project copy of a shipped skill is silently inert.

A project that needs something the shared skill does not do should reach for a config seam, not a fork: `copilot.handoverCommand` exists because a forked `meeting-copilot` was the only way a project could hand its own transcript on, and a fork of a skill that already drifts silently is that failure twice.

`transcript-recover` and `set-repair` are two halves of recovery, split because their **costs** differ. `set-repair` is mechanical, cheap, safe to run often: orphaned `capture.pid`, a transcript nothing ever handed over (a real project held a 539-line one — an entire meeting — found by accident), a stale `wall.pid`, an archive with no stitched artifacts. It never repairs by a new mechanism — an unconsumed transcript is handed over by `stop`, reusing the one `renameSync` — and reports anything destructive rather than running it. `transcript-recover` is a *content* pass costing a model read per transcript, and it ends by handing off in the other direction. `doctor` probes the audio chain; `set-repair` inspects runtime state; they do not overlap.

### The replay harness — how a copilot change is shown to be an improvement

**Scenarios live outside this repo.** `scenarios/smoke` is the only one here — neutral by
construction, the proof that nothing is deck-specific. The real measuring sticks are built
from a partner's material (an imagined presentation of a real deck: its sentences, figures
and names), so they live in a separate PRIVATE repo and are passed by path. Every command
takes a directory, and the engine neither knows nor needs to know where it is — the same
seam as `knowledge.sources`. A fixture that would embarrass someone if it were public
belongs on the other side of that line, and the line is a repo boundary rather than a
`.gitignore` entry because a gitignore protects nothing once someone commits with `-f`.

`set-copilot replay` plays a recorded scenario into a runtime dir's transcript, paced by
the scenario's own timestamps, while holding the runtime dir the way a capture does. A
polling consumer cannot tell the difference — and that is the whole point: the measurement
covers the production path, not a mock. `docs/replay-harness.md` is the runbook.

The property everything rests on: **the consumer side is untouched.** `poll`, the wall, the
mirror and the skills need no flag, no config, no code path for a replay. If a change to
any of them ever turns out to be necessary to make replay work, that is a finding about a
hidden coupling, to be reported rather than papered over — and the measurement is invalid
until it is understood.

Four rules carry it, each of which a run has already justified:

- **A fixture's metadata never reaches the transcript.** A script entry wraps its
  transcript line and carries the section of the source material for the timeline only.
  On the played line it would hand the copilot a structured outline of a talk it is
  supposed to be following by ear, and every score taken afterwards would describe a
  copilot nobody ships.
- **Speed is a validity fact, not a label.** Real time is the default and the only speed
  whose latency figures mean anything: a model's thinking time does not scale with
  playback, so a sped-up run flatters the copilot. The speed travels into the run record,
  and a scorecard built on a non-real-time run reports its latency dimensions as
  *invalid*, never as a smaller number. The same applies when the player itself fell
  behind — that would measure the player.
- **A dimension refuses rather than guesses.** No judged matching → coverage is *unknown*,
  never zero. An unstamped wall event → coverage and precision are unmeasurable, because
  an event with no `emittedAt` can never fall inside a moment's window. That distinction —
  "the copilot did not react" versus "the log cannot say when" — was found by scoring a
  real run as a total failure when in fact every planted moment had been answered.
- **Mechanical and judged stay apart.** Counting and timing are pure functions, identical
  on every run of the same artifacts; whether a reaction actually *addressed* a planted
  moment arrives from outside as a matching, with its reasoning recorded. A
  non-deterministic verdict leaking into a counted dimension would destroy the one
  property a regression measure needs.

**A score is not evidence until the measure's own noise is known.** Measured 2026-08-23 on
three real-time runs of one scenario with nothing changed: coverage spanned 0.222. At seven
planted moments the spread was worse — one moment was a seventh of the score — and a
comparison reported a regression where nothing had changed. So a scenario carries a measured
`noiseBand`, a difference inside it is reported as unchanged rather than as a verdict, and a
scenario with no band declared still compares but says a single-run difference is a reading,
not evidence. Two rules the band itself needs: round it **up** (a band rounded down excludes
the very runs that defined it), and treat `N=3` as a **lower** bound on the noise. The band is
deliberately NOT part of the scenario fingerprint — it changes no dimension's value, only how a
comparison is worded, and including it made the ruler circular: measuring the noise needs runs,
recording the result changed the fingerprint, which invalidated those very runs.

Two things the harness deliberately does **not** cover, stated because a green scorecard
would otherwise be read as covering them. It does not exercise `transcript-writer`: a
scenario carries finished lines, not a token stream, so the flush rules never run — putting
the fixture through them would make the measuring stick change whenever the flusher did.
And a scenario is a *fixture*, not a prediction of what a real presenter would say; its
value is that it is identical every time.

The runner must load the real policy (`set-copilot prompt`) before polling. A hand-written
runner prompt once made a session look like it had hit two gaps in the drawing contract;
re-reading the rendered prompt refuted both. A run without the policy scores a copilot
nobody ships, and its findings are noise.

## Positioning — why this exists next to `/voice`

Claude Code has built-in dictation (`/voice`, hold/tap `Space`). Don't let a change erode the reasons set-copilot is still worth using, and don't claim advantages it doesn't have. The real ones, as of 2026-07:

- **Language.** `/voice` supports 20 languages; Hungarian is not one of them. Soniox covers 60+.
- **Length.** `/voice` caps at 2 minutes and stops after 15s of silence. Ours takes `--max-minutes` and treats silence as an event.
- **Auth.** `/voice` requires a claude.ai account (no API key / Bedrock / Vertex).
- **System audio.** `/voice` is mic-only, so it cannot host a meeting copilot at all. That capability is the package's real reason to exist.


## Auto-Commit After Apply
<!-- set-core:managed — DO NOT edit or remove this section. It is auto-generated by `set-project init`. -->

After a skill-driven apply (e.g. `/opsx:apply`) finishes or pauses, automatically commit all changes. Follow the standard commit flow (stage relevant files, write a concise commit message).

## Getting Started
<!-- set-core:managed — DO NOT edit or remove this section. It is auto-generated by `set-project init`. -->

See [START.md](START.md) for application startup commands (install, dev server, database, tests).

## Persistent Memory
<!-- set-core:managed — DO NOT edit or remove this section. It is auto-generated by `set-project init`. -->

This project uses Claude Code's own per-repository memory: Markdown files under
`~/.claude/projects/<project-slug>/memory/`, indexed by `MEMORY.md`.

**How it actually loads — the limit matters:**
- Only the **first 200 lines, or 25 KB**, of `MEMORY.md` are injected at session start.
  Content past that cut loads for nobody, and nothing warns you. Keep the index to one
  line per memory.
- The individual topic files are **not** loaded at startup. Read them with ordinary file
  tools when the index says one is relevant.
- Use `/memory` to browse and edit, `/context` to see what actually loaded this session.

**What it does NOT do**, so you reach for a documented absence rather than a missing
feature: no semantic search, no tag filtering, no temporal queries, no full-text search,
no cross-device sync, no version history, and no automatic session-end extraction.
Searching means reading the index and opening the file it points at.

**Writing a memory:** one fact per file, with a `name`, a one-line `description`, and a
`type` of user / feedback / project / reference. Add a one-line pointer to `MEMORY.md`.
Never store a harness artifact verbatim — a task notification, another agent's prompt, a
transcript fragment — and never record a claim about the user's emotional state.

**Confidentiality:** no memory file may carry a consumer project name, a partner name, a
personal name, or content derived from a customer's data. Generalise before saving; a
memory naming a real entity is a defect to correct, not harmless content.
