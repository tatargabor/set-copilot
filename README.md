# set-copilot

Voice dictation **and** a real-time meeting copilot for [Claude Code](https://claude.com/claude-code).

- **Dictate** — press `/ds`, speak into your mic, the text arrives in Claude Code as if you typed it. `/dd` to stop.
- **Meeting copilot** — `/meeting-copilot start` streams a live transcript and cross-references what's being said against **your project's knowledge base**, flagging contradictions with past decisions, surfacing relevant context, and catching new decisions worth recording — all inside your existing Claude Code session.

Speech-to-text is powered by [Soniox](https://soniox.com) (real-time WebSocket, multilingual — Hungarian and English verified). No other API keys or servers required: the copilot's "intelligence" is just the Claude Code session you're already in.

> Extracted from a production ERP project and generalized. The engine is knowledge-agnostic; you plug in your own knowledge source via config.

## Requirements

- Node.js ≥ 18
- A [Soniox](https://soniox.com) API key
- Audio capture tooling:
  - **Linux**: `parec` (PipeWire/PulseAudio) — usually preinstalled. `notify-send` for desktop alerts.
  - **macOS**: `sox` (`brew install sox`). System-audio capture for meetings needs [BlackHole](https://github.com/ExistentialAudio/BlackHole); dictation needs only the mic.

## Install

```bash
npm install --save-dev set-copilot   # or: npm i -g set-copilot
npx set-copilot init                  # scaffolds skills + config into this project
```

`init` writes:
- `.claude/skills/{dictate,dd,ds,meeting-copilot}/` — the Claude Code skills
- `set-copilot.config.json` — project config (edit `knowledge.sources`)

Then add your key to `.env`:
```
SONIOX_API_KEY=your_key_here
```

## Quickstart

**Dictation** (needs no knowledge config):
```
/ds        → 🔴 recording, speak…
/dd        → stops, and Claude acts on what you said
/ds 10     → record with a 10-minute limit
```

**Meeting copilot** (cross-references your docs):
```
/meeting-copilot start          active lookup (Grep/Read during the meeting)
/meeting-copilot start --lite   pre-load context, zero lookups (fastest reactions)
/meeting-copilot start --zero   no knowledge load, pure conversation context
/meeting-copilot stop
```

## Configuration — `set-copilot.config.json`

```jsonc
{
  "language": "hu",                 // Soniox language hint
  "runtimeDir": "/tmp/set-copilot", // scratch dir for transcript + state
  "sonioxMode": "rt",               // "rt" (low latency) | "chunk" (10s fallback)
  "audio": { "micSource": "", "monitorSource": "", "sampleRate": 16000 },
  "knowledge": {
    "adapter": "markdown",          // built-in, or a path to your own adapter module
    "sources": ["docs/knowledge"],  // dirs/files the markdown adapter scans
    "decisions": "docs/knowledge/decisions",
    "decisionIdPrefix": "DEC",      // annotate transcript refs like "DEC-003"
    "keywords": {
      "partners": [{ "topic": "Acme Kft.", "stems": ["acme"] }],
      "features": [{ "topic": "invoice", "stems": ["invoice", "számla"] }]
    }
  }
}
```

Secrets never go in this file — `SONIOX_API_KEY` comes from `.env` / the environment.

`micSource` / `monitorSource` are device names. List them with:
```bash
npx set-copilot sources
```

## Knowledge adapters

The copilot's cross-referencing is driven by a **knowledge adapter** that turns your source of truth into three artifacts (a keyword index, an enriched context JSON, and a markdown digest). Rebuild them any time with `npx set-copilot digest`.

### Built-in: `markdown`

Scans `knowledge.sources` for `.md` files and derives:
- **keyword patterns** from your configured `keywords` seeds
- **decisions** from the `decisions` directory (frontmatter `status`/`title`, `superseded` skipped)
- **deferred / out-of-scope** items grepped from pages
- **domain FAQ** from page headings
- **recent incidents** from `git log --grep=fix` (last 30 days)

Good enough for any project whose knowledge lives in markdown.

### Custom adapter

For a database, Notion, Confluence, etc., point `adapter` at a module that default-exports a factory:

```ts
// copilot-adapter.ts
import type { AdapterContext, KnowledgeAdapter } from "set-copilot/knowledge";

export default function createAdapter(ctx: AdapterContext): KnowledgeAdapter {
  return {
    name: "my-db",
    async keywordPatterns() {
      // e.g. pull active customer names from your DB and turn them into stems
      return [...ctx.seedKeywords /* , ...fromDb */];
    },
    async enrichedContext() { /* decisions, cards, deferred, faq, incidents */ },
    async digestMarkdown() { /* compact human-readable summary */ },
  };
}
```

```json
{ "knowledge": { "adapter": "./copilot-adapter.ts" } }
```

The engine stays generic; your project-specific enrichment lives in your repo.

## CLI

```
set-copilot init                 scaffold skills + config into this project
set-copilot capture [--mic-only] start capture (mic-only = dictation)
set-copilot stop                 stop the running capture
set-copilot status               capture state + transcript line count
set-copilot digest               (re)build knowledge index/context/digest
set-copilot poll [seconds]       long-poll the transcript (used by the copilot)
set-copilot sources              list audio input devices
set-copilot beep                 OS start/stop chime
set-copilot notify <t> [b]       OS desktop notification (--critical)
set-copilot path <name>          print a resolved runtime path
```

## How it works

```
                 ┌─ mic  ──┐                          ┌── Claude Code session
 set-copilot     │         ├─ Soniox ─ sentence ── transcript.jsonl
 capture ────────┤         │           buffer         │
                 └─ system ┘  (meeting mode only)      ├─ set-copilot poll (long-poll monitor)
                                                       ├─ Read / Grep  (your knowledge base)
                                                       └─ chat output  (⚠ 📋 ✏ ❓)
```

- The capture process writes sentence-level JSONL (flush on `. ? !`, speaker change, 3s silence, or 80-word overflow), annotating each line with matched `topics`, `urgency`, and `question` flags.
- In dictation mode, capture is mic-only and no analysis runs — `/dd` just reads the buffer and hands the text to Claude.
- In meeting mode, the skill runs a long-poll Monitor; each batch of new speech becomes one notification that Claude answers with knowledge-backed context.

## License

MIT
