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
- **`src/transcript-writer.ts`** — buffers final tokens per speaker and flushes a JSONL line on sentence boundary, speaker change, 3s silence, or 80-token overflow. Annotates each line with `topics` (keyword matches), `urgency`, `question`. Also emits one `{"type":"silence"}` event per silence period. Note: Soniox v5 tokens carry their own leading spaces — concatenate, never join with spaces.
- **`src/capture.ts`** — wires the above together; also owns the runtime-dir invariants (below).
- **`src/poll.ts`** — long-poll consumed by the meeting-copilot Monitor loop. Tracks a byte-independent line offset in `poll-offset`, dedups mic/system echo, returns early on an urgent/question/silence event, and emits `{"type":"capture-dead"}` when the capture PID is gone.
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

**Public-zone redaction** (`redaction.ts`) runs server-side in the shared `ingest` funnel, before any broadcast or accumulation — a producer-side filter fails open, and the JSONL tailer bypasses the CLI, so this is the only place that catches every producer. It is the highest-stakes code in the project: a mistake puts internal data on a public wall in front of a live audience, so the whole design is *fail-closed* — when in doubt, withhold, don't scrub. The shape it has was forced by four adversarial verifiers reproducing leaks through an earlier field-list version:

- **Recursive, not a field list.** The payload is open (`GraphNode`/`ChartDatum` carry `[k: string]: unknown`), so the redactor walks every string leaf at any depth under any key. A list can never be complete; a walk is closed to future keys too.
- **A matching URL (`image.src`/`webpage.url`) withholds the whole event**, never scrubs — a token in a URL can't be removed while leaving the link usable.
- **Per-delta zone in accumulation.** A visual's deltas accumulate into separate private/public slices; a public join replays from the public slice, which never received the private deltas. This is what closed the replay-laundering leak — do not collapse it back to one zone per visual.
- **The `show` command is zoned** to where its visual lives, because a `visual` id is free producer text and can itself be sensitive.
- **Bounded evaluation (ReDoS).** Two structural limits at config-load — no repeated group (`)` followed by `*`/`+`/`{`, which kills the exponential class outright) and at most 2 unbounded quantifiers (which caps polynomial backtracking at quadratic) — plus a per-leaf length cap that bounds that quadratic. Rejecting *classes* structurally, not guessing *which* patterns are dangerous: three adversarial rounds proved the guess-the-danger approach is walkable. Patterns are config-only (never a producer or the transcript), so this bounds an operator footgun; re2 is the localized swap for a hard linear guarantee.

Two rules deliberately break the wall's usual "drop it with a warning and carry on" posture, because here a mistake is *published* rather than logged: a redaction failure (compile error, timeout, unexpected shape) **withholds** the event from the public zone, and an uncompilable or catastrophic pattern is dropped loudly at load. It is a shape-matcher, not a classifier and not a security boundary — `zone: "private"` remains the only reliable way to keep something off the public wall. The private view marks (a corner badge / line style) what the public wall did not get, so a silent redaction is never mistaken for one that did not run.

### Everything project-specific is config, not code

This package was extracted from one ERP project, and the recurring failure mode is that project leaking back into the engine. Five seams exist to prevent it — when a behavior feels domain-specific, it belongs behind one of them, not in a regex in `src/`:

- **`copilot.alerts`** — the alert taxonomy (⚠ contradiction / 📋 context / ✏ new decision / ❓ question) is *data with defaults in `config.ts`*, not prose in the skill. `SKILL.md` owns the mechanics; the policy comes from `set-copilot prompt`. Adding a category must never mean editing the skill.
- **`detect.urgency` / `detect.question`** — the regexes behind the per-line flags. Defaults cover English + Hungarian; anything else is configured, and a user-supplied bad regex is dropped with a warning rather than killing the capture.
- **`knowledge.keywords` + `autoKeywords`** — a flat `[{topic, stems}]` list (named groups are flattened for back-compat), with topics auto-derived from page titles, `##` headings, and frontmatter tags.
- **`copilot.drawing` (the drawing contract)** — the knowledge a producer fork needs to draw the wall: the category-registry summary, the `wall-emit` payload shapes, the render types, and the when-to-graph/chart/text conventions. Like `copilot.alerts`, it is *data with defaults in `config.ts`*, rendered into `set-copilot prompt` as its own block — so a project can rename its categories or reshape what gets drawn without forking the skill. It lives in the base context (loaded once, cache-warm) precisely because every draw needs it; the per-draw fork prompt stays a one-line mandate.
- **`wall.redaction`** — the public-zone redaction *taxonomy* (patterns, replacement, the `[belső]`/`[internal]` marking convention, the input-length cap). The *mechanism* (recursive walk, URL withholding, fail-closed, ReDoS bound, per-delta replay zoning) is engine, in `redaction.ts`; only the taxonomy is config. The shipped default is domain-neutral — it matches a marking convention, not any project's names — so a fresh project never silently redacts, or fails to redact, against another project's vocabulary. The convention the default relies on is taught to the producer in the drawing contract, not left as a phantom.

Word boundaries are Unicode (`\p{L}\p{N}`), never `\b` or an enumerated Latin+Hungarian character class — `\b` treats `á` as a boundary and silently breaks every accented language.

### Runtime-dir invariants

A capture **owns** its runtime dir (transcript + `capture.pid` + `capture.output` + `poll-offset`). The `/ds` and `/dd` skills scope it per Claude session via `SET_COPILOT_DIR="$PWD/.set/copilot/$CLAUDE_CODE_SESSION_ID"`, and `stop` finds the capture *through that directory* — so any change that touches the path must keep `capture` and `stop` byte-identical.

Two rules are load-bearing and were each fixed after a real failure; don't regress them:

1. **A transcript is handed over exactly once.** `stop --print` prints, then renames the file to `<name>-<timestamp>.jsonl`. Without the archive step a double `/dd` replays the previous dictation as if freshly spoken and Claude acts on it twice. `capture` likewise archives (never truncates) an unconsumed transcript it finds.
2. **A second capture in the same runtime dir is refused** while one is live. Overwriting the PID file would orphan the first process — still recording, nothing able to stop it.

### Skills

`skills/{ds,dd,dictate,meeting-copilot}/SKILL.md` are shipped in the npm package and copied by `set-copilot init` into `.claude/skills/` (or `~/.claude/skills/` with `--global`). They are *prompts*, not code: they invoke the CLI and define how Claude reacts to transcript batches. Mechanics (the poll loop, the output shape, the phase order) belong in `meeting-copilot/SKILL.md`; *judgement* (what is worth speaking up about) belongs in `copilot.alerts` / `copilot.instructions` so a project can change it without forking the skill.

## Positioning — why this exists next to `/voice`

Claude Code has built-in dictation (`/voice`, hold/tap `Space`). Don't let a change erode the reasons set-copilot is still worth using, and don't claim advantages it doesn't have. The real ones, as of 2026-07:

- **Language.** `/voice` supports 20 languages; Hungarian is not one of them. Soniox covers 60+.
- **Length.** `/voice` caps at 2 minutes and stops after 15s of silence. Ours takes `--max-minutes` and treats silence as an event.
- **Auth.** `/voice` requires a claude.ai account (no API key / Bedrock / Vertex).
- **System audio.** `/voice` is mic-only, so it cannot host a meeting copilot at all. That capability is the package's real reason to exist.
