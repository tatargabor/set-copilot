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

### Everything project-specific is config, not code

This package was extracted from one ERP project, and the recurring failure mode is that project leaking back into the engine. Three seams exist to prevent it — when a behavior feels domain-specific, it belongs behind one of them, not in a regex in `src/`:

- **`copilot.alerts`** — the alert taxonomy (⚠ contradiction / 📋 context / ✏ new decision / ❓ question) is *data with defaults in `config.ts`*, not prose in the skill. `SKILL.md` owns the mechanics; the policy comes from `set-copilot prompt`. Adding a category must never mean editing the skill.
- **`detect.urgency` / `detect.question`** — the regexes behind the per-line flags. Defaults cover English + Hungarian; anything else is configured, and a user-supplied bad regex is dropped with a warning rather than killing the capture.
- **`knowledge.keywords` + `autoKeywords`** — a flat `[{topic, stems}]` list (named groups are flattened for back-compat), with topics auto-derived from page titles, `##` headings, and frontmatter tags.

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
