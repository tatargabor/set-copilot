# Wall + meeting-copilot — field backlog

Prioritized backlog distilled from **real-world use of set-copilot** in the `consumer-c`
project (Claude Code session transcripts, 2026-07, ~4 live meetings + dictation sessions).
Each item is a candidate `/opsx:propose` change. Ordered by impact × how often it bit.

The learnings that reshaped the `wall-chat-mirror` change (hook enforcement, `chat-wide`
rename, no dead region) are already folded into that change and are **not** repeated here.

## P0 — breaks the live demo

> **Also P0, filed separately with full evidence and an acceptance list:**
> [handoff-transcript-stitch.md](handoff-transcript-stitch.md) — raw JSONL lines are still
> sentence fragments after `a30d12f` (38% of lines on a post-fix recording), nobody consumes
> `cont`/`midWord`/`startTs`, and a real client fact was **lost from a knowledge base** because
> the note-taking step read the fragments. Asks for a `transcript` command + stop-time
> stitching; a working reference implementation already exists in `consumer-c`.

1. **Live-narration text box stalls on "copilot kész".** The #1 field complaint (2 sessions):
   the left text/narration box stops refreshing and freezes on a terminal line, while graph/
   chart draws keep working. → Investigate the `live-narration` / `wall-liveness` stream
   lifecycle; a terminal message must not wedge the lane.
2. **SSE client does not auto-reconnect.** After a drop the wall goes stale (observed ~13 min)
   and only a hard reload recovers; box/category changes also need a reload. The server sends
   `retry: 2000` but the client never re-bootstraps. → Client reconnect + re-bootstrap on SSE
   error. (Runtime *layout* push already lands live as of `wall-chat-mirror`; this is the
   broader reconnect.)
3. **Cold-start wall latency ~20s, blank wall.** The first draw of a session has no staged
   prediction to promote, so the opening request reads as a dead wall. → A visible "drawing…"
   placeholder on the wall itself the instant a draw is requested (the pending-indicator exists
   — confirm it fires on the first/cold draw), and confirm predictive-staging warms the opener.

## P1 — high friction, hit repeatedly

4. **Soniox mangles domain jargon + proper nouns.** Most repeated transcription pain (3+
   sessions): "consumer-a"→"VPC pont", "Railway"→"realway", "MVP"→"MVE", Hungarian names
   ("Szluka"→"Sluka"). Users hand-write normalization tables into `copilot.instructions` as a
   workaround. → A custom-vocabulary / term-boost seam (Soniox context hints wired from
   `knowledge.keywords`, or a post-transcript glossary-normalization pass).
5. **`--max-minutes 120` kills capture mid-meeting; transcript splits.** At the 2h cap capture
   emitted `capture-dead`; the copilot manually restarted and had to concatenate two transcript
   segments. → Raise/omit the default for meeting mode, or auto-restart capture on the cap and
   keep one continuous transcript.
6. **Monitor forces a visible reply per event → ~31% "Csend." filler.** Empty acknowledgements
   were emitted (and some mirrored to the public wall + read aloud). → Let a poll/Monitor batch
   with no alert be a legitimate no-op turn (align with `reactive`/`silent` engagement); never
   surface filler.
7. **No `status`/`ps` view of which capture+wall belongs to which session/port.** Recurring
   cross-session confusion when stopping the right one; the +1 port auto-increment on collision
   is invisible. → A `set-copilot status --all` (or `ps`) listing running captures+walls with
   their scoped runtime dir + bound port.
8. **`wall.windows` fully overrides instead of merging.** Adding one box to `/wall` dropped the
   default boxes and tripped the "position empty" warning; the operator had to rebuild all
   defaults by hand. → Deep-merge window/box config over defaults, or an add-box CLI.
9. **Pinned info scrolls off.** The scrolling log buried the open-questions list ("kurvára
   keresem az öt nyitott kérdést"). → Ship a pinned/`latest` summary box in the default `/wall`
   layout (this is also the deferred `chat-wide` right-lower region).

## P2 — smaller / polish

10. **Orphaned foreign wall on the fixed default port.** A wall from another project on 4180
    silently served the wrong runtime dir; emits went to the right dir, the screen read the
    wrong one. → Identify a wall by its `runtimeDir`; warn/refuse when the port's wall belongs
    to a different dir; make the +1 fallback visible.
11. **`--help` / `set-copilot --help` misbehaves.** `wall --help` tried to bind (EADDRINUSE);
    top-level `--help` printed "Unknown command". → Short-circuit help before any bind; accept
    `--help`/`-h`.
12. **Clean wall shutdown looks like a crash (exit 144).** A normal meeting-end wall stop
    surfaced as a failed background command. → Exit 0 on clean SIGTERM stop.
13. **`fork` agent type assumed by the drawing contract may not exist** in every harness
    (observed on one model): `Agent type 'fork' not found`. → Fall back to `general-purpose` or
    an inline draw path, or document the requirement.
14. **Wall text box swallows newlines / markdown tables illegible.** No `white-space: pre-wrap`
    on `.line .txt` (fix reportedly already in a working tree); markdown tables arrive as
    run-on text. → Land `pre-wrap`; either render minimal markdown or document plain-text/`\n`.
15. **Mic emits spurious repeated short finals ("Igen.") during silence**, polluting the saved
    transcript. → Tighter silence/VAD gating or a short-repeated-final filter.
16. **Custom knowledge adapter can silently ignore `knowledge.sources`** (a project adapter
    hardcoded its domain dir). → Make `ctx.sources` the documented single source of truth, or
    validate/warn when an adapter never reads it.

## Product-shaped (not bugs — future direction)

- **Copilot auto-switches presentation screens** on one shared window (Meet can't share two) —
  a wall auto-cycle/director mode over layout box-positions.
- **"Mikroelőrejelzések"** — live dashboard-style micro-predictions from incremental signals
  (extends predictive-staging).
- **Screen awareness** — the copilot is blind to the UI; the operator must narrate it.
- **Naming** — "Copilot" is a Microsoft brand; the differentiator pitched is live
  narrate+analyze+visual-cue on a shared wall.

## What worked well — protect, do not regress

Knowledge cross-referencing with source-cited contradiction-catching (the star, every meeting) ·
public/private zone judgment held under stress (salaries, a named-client PDF withheld) ·
mic/system speaker separation over 2-hour calls (the load-bearing differentiator vs `/voice`) ·
the categorized meeting summary · JSONL-transcript reuse into a docs pipeline · predictive-staging
draws · clean `capture → poll → wall → stop` lifecycle · reliable `/ds`→`/dd` dictation for plain
Hungarian.
