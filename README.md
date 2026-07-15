# set-copilot

Voice dictation **and** a real-time meeting copilot for [Claude Code](https://claude.com/claude-code).

- **Dictate** — press `/ds`, speak into your mic, the text arrives in Claude Code as if you typed it. `/dd` to stop.
- **Meeting copilot** — `/meeting-copilot start` streams a live transcript and cross-references what's being said against **your project's knowledge base**, flagging contradictions with past decisions, surfacing relevant context, and catching new decisions worth recording — all inside your existing Claude Code session.

Speech-to-text is powered by [Soniox](https://soniox.com) (real-time WebSocket, multilingual). No other API keys or servers required: the copilot's "intelligence" is just the Claude Code session you're already in.

## Why, when Claude Code has `/voice`?

Claude Code ships [built-in dictation](https://code.claude.com/docs/en/voice-dictation.md) — `/voice`, hold or tap `Space`. **If it works for you, use it.** It's free, it's one keystroke, and it needs no setup.

It does not work for everyone. The gaps are why this exists:

| | Claude Code `/voice` | set-copilot |
|---|---|---|
| **Languages** | [20 supported](https://code.claude.com/docs/en/voice-dictation.md) — no Hungarian, no Romanian, no Croatian… | whatever Soniox supports — [60+](https://soniox.com/docs/speech-to-text/core-concepts/supported-languages), Hungarian included |
| **Length** | 2 min max, cuts off after 15s of silence | `--max-minutes N` (`/ds 10`); pauses are fine — silence is an event, not a stop |
| **Auth** | Claude.ai account only | any Claude Code auth (API key, Bedrock, Vertex, Foundry) |
| **System audio** | mic only | mic **+** system output — the whole basis of the meeting copilot |
| **Cost** | included | your Soniox bill |

So: `/voice` is the better default for an English speaker on a claude.ai plan dictating a short prompt. set-copilot is for everyone outside that box — an unsupported language, a long dictation you don't want truncated, or a non-claude.ai auth.

And dictation is really the on-ramp. **The meeting copilot has no built-in equivalent**: `/voice` can't capture the other side of a call, so it can't hear a customer contradict a decision you recorded six months ago. That part is the point of the package.

> Extracted from a production ERP project and generalized. The engine is knowledge-agnostic and language-agnostic; you plug in your own knowledge source and your own policy via config.

## Requirements

- Node.js ≥ 18
- **A speech-to-text backend** — pick one:
  - [Soniox](https://soniox.com) API key (cloud, low latency, 60+ languages), or
  - **local whisper** (free, offline, no key): `brew install whisper-cpp` + a ggml model in `~/.config/set-copilot/models/` — set `"sttBackend": "whisper"`
- Audio capture tooling:
  - **Linux**: `parec` (PipeWire/PulseAudio) — usually preinstalled. `notify-send` for desktop alerts.
  - **macOS**: `sox` (`brew install sox`). System-audio capture for meetings needs [BlackHole](https://github.com/ExistentialAudio/BlackHole); dictation needs only the mic. Cloning the repo? `brew bundle` installs both from the [`Brewfile`](Brewfile).

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

Verify the audio chain before your first meeting — it probes the real devices for signal, rather than guessing:
```bash
npx set-copilot doctor
```

### Install once, dictate everywhere

Dictation needs no project config, so it is worth installing user-wide instead of per repo:

```bash
npm i -g set-copilot
set-copilot init --global      # ~/.claude/skills + ~/.config/set-copilot/
```

That writes the skills into `~/.claude/skills/` and the config plus a `0600` `.env` into `~/.config/set-copilot/` (or `$XDG_CONFIG_HOME`). Put your key in that `.env` once and `/ds` works from any directory. A project's own `set-copilot.config.json` / `.env` still wins over the user-level one, so a repo can override the language, mic, knowledge, or copilot policy without a second key.

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

Every field is optional. Dictation works with an empty config; the copilot needs `knowledge.sources`.

```jsonc
{
  "language": "en",                 // STT language hint ("auto" lets whisper detect)
  "runtimeDir": "/tmp/set-copilot", // scratch dir for transcript + state
  "sttBackend": "soniox",           // "soniox" (cloud, needs a key) | "whisper" (local, free/offline)
  "sonioxMode": "rt",               // "rt" (low latency) | "chunk" (10s fallback)
  "whisper": {                      // used only when sttBackend === "whisper"
    "bin": "whisper-cli",           // whisper.cpp binary (brew install whisper-cpp)
    "model": ""                     // path to a ggml model; empty → ~/.config/set-copilot/models/ggml-base.bin
  },
  "audio": { "micSource": "", "monitorSource": "", "sampleRate": 16000 },

  "knowledge": {
    "adapter": "markdown",          // built-in, or a path to your own adapter module
    "sources": ["docs/**/*.md", "notes", "ARCHITECTURE.md"],
    "decisions": "docs/decisions",  // optional: markdown + frontmatter (id/title/status)
    "decisionIdPrefix": "DEC",      // annotate transcript refs like "DEC-003"
    "autoKeywords": true,           // derive topics from page titles, ## headings, tags
    "keywords": [                   // optional hand-written seeds, on top of the derived ones
      { "topic": "Acme", "stems": ["acme"] },
      { "topic": "invoice", "stems": ["invoic", "számlá?"] }
    ],
    "deferredMarkers": ["out-of-scope", "deferred:\\s*\\S+", "TBD"]
  },

  "copilot": {
    "instructions": "docs/copilot-prompt.md",  // your domain rules, loaded verbatim
    "alerts": [                                // what the copilot may speak up about
      { "key": "contradiction", "emoji": "⚠", "priority": "high", "notify": true,
        "when": "it contradicts an active decision or treats a deferred item as in scope" },
      { "key": "pricing", "emoji": "💰", "priority": "high",
        "when": "a discount above 20% is floated" }
    ]
  },

  "detect": {                       // per-line flags the copilot routes on
    "urgency": ["\\b(broken|outage|regression)\\b"],
    "question": ["[?]\\s*$"]
  }
}
```

Secrets never go in this file — `SONIOX_API_KEY` comes from `.env` / the environment.

Resolution order, later wins: built-in defaults → `~/.config/set-copilot/set-copilot.config.json` → the project's `set-copilot.config.json` → environment variables (`SET_COPILOT_DIR`, `MIC_SOURCE`, `SONIOX_MODE`, `SET_COPILOT_LANGUAGE`). Sections merge key by key, so a project can override `knowledge.sources` without restating your user-level `keywords`. The API key is read from the environment, then the project `.env`, then the user-level one.

`micSource` / `monitorSource` are device names. List them with `npx set-copilot sources`.

### Nothing here is English- or ERP-shaped

Three knobs keep the engine generic; all three have working defaults, so you only touch them if your project disagrees:

- **`knowledge.sources`** takes directories, single files, or globs (`docs/**/*.md`, `notes/2026-*.md`). No layout is assumed — a docs tree, a decisions folder, a pile of meeting notes, all fine.
- **`copilot.alerts`** is the whole alert taxonomy as data. The defaults are ⚠ contradiction / 📋 context / ✏ new decision / ❓ question; drop them, reword them, or add `💰 pricing`, and the skill follows — `set-copilot prompt` renders your categories into the copilot's policy. `copilot.instructions` points at a markdown file of your own domain rules, loaded verbatim alongside them.
- **`detect.urgency` / `detect.question`** are the regexes behind the `urgency` and `question` flags on each transcript line. Defaults cover English and Hungarian; replace them for any other language.

Keyword matching itself is script-agnostic (Unicode word boundaries), so stems work in Cyrillic, Greek, or Hungarian without configuration, and match inside inflected forms — `invoic` hits "invoicing", `számlá` hits "számlázás".

## Knowledge adapters

The copilot's cross-referencing is driven by a **knowledge adapter** that turns your source of truth into three artifacts (a keyword index, an enriched context JSON, and a markdown digest). Rebuild them any time with `npx set-copilot digest`.

### Built-in: `markdown`

Scans `knowledge.sources` for `.md` files and derives:
- **keyword patterns** — page titles, `##` headings and frontmatter `tags` (with `autoKeywords`), plus your configured seeds. Document furniture ("Overview", "TODO", "Next steps") and prose headings are filtered out.
- **decisions** from the `decisions` directory (frontmatter `status`/`title`, `superseded` skipped)
- **deferred / out-of-scope** items grepped with your `deferredMarkers`
- **domain index** from page headings
- **recent incidents** from `git log --grep=fix` (last 30 days)

Good enough for any project whose knowledge lives in markdown — with `autoKeywords`, a project with ordinary docs gets useful topic routing and an empty `keywords` array.

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

## Runtime dir — one per Claude session

A capture owns its runtime dir: the transcript, a PID file, and the poll offset all live there. Two captures sharing one dir would collide, so the shipped `/ds` and `/dd` skills give each Claude Code session its own:

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/$CLAUDE_CODE_SESSION_ID"
```

`CLAUDE_CODE_SESSION_ID` is the same UUID that names the conversation history file (`~/.claude/projects/<project>/<id>.jsonl`), so a dictation is traceable to the conversation it fed. Point `SET_COPILOT_DIR` (or `runtimeDir` in the config) anywhere else if you prefer — just keep it identical between `capture` and `stop`, since `stop` finds the capture through it.

Transcripts are never destroyed. Handing one to Claude (`stop --print`) archives it as `dictation-<timestamp>.jsonl`, and a capture that finds an unconsumed transcript archives that too rather than truncating it. Two guarantees follow:

- **A transcript is handed over exactly once.** A second `/dd` prints nothing instead of replaying the last dictation as if you had just spoken it.
- **A second capture in the same dir is refused** while one is live — otherwise it would steal the PID file and orphan the first process, which would keep recording with nothing able to stop it.

## CLI

```
set-copilot init [--global]      scaffold skills + config (--global: user-wide)
set-copilot capture [--mic-only] start capture (mic-only = dictation)
                    [--max-minutes N]
set-copilot stop [--print]       stop the capture (--print: emit the transcript once)
set-copilot status               capture state + transcript line count
set-copilot digest               (re)build knowledge index/context/digest
set-copilot prompt               print the copilot policy (alert categories + instructions)
set-copilot poll [seconds]       long-poll the transcript (used by the copilot)
set-copilot sources              list audio input devices
set-copilot doctor               audio + env health check (probes for real signal)
set-copilot beep [--end]         OS start/stop chime
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

- The capture process writes sentence-level JSONL (flush on `. ? !`, speaker change, 3s silence, or 80-token overflow), annotating each line with matched `topics`, `urgency`, and `question` flags.
- In dictation mode, capture is mic-only and no analysis runs — `/dd` stops the capture and hands the buffered text to Claude, archiving it in the same step so it cannot be replayed.
- In meeting mode, the skill runs a long-poll Monitor; each batch of new speech becomes one notification that Claude answers with knowledge-backed context, under the policy from `set-copilot prompt`.

## Development

```bash
npm run build          # tsc → dist/
npm run dev -- doctor  # run the CLI from source
npm test               # vitest
```

## License

MIT
