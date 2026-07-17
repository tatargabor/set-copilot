---
name: meeting-copilot
description: Real-time meeting assistant — monitors live transcription and cross-references against the project knowledge base
user_invocable: true
---

# Meeting Copilot Skill

Real-time meeting assistant that monitors a live transcript and cross-references what's being said against the project's knowledge base, specs, and past decisions. Powered by `set-copilot`.

The copilot is NOT a separate AI — it IS this Claude Code session. The `set-copilot` capture process handles audio + transcription; Claude Code handles analysis via a Monitor loop + filesystem access to your knowledge base. The only external dependency is Soniox for transcription.

Both halves are config, not code:
- **Knowledge** — `knowledge.sources` (dirs, files, or globs), `knowledge.decisions`, `knowledge.keywords`. The digest step reads those and produces three artifacts the copilot consumes.
- **Policy** — `copilot.alerts` (what to speak up about) and `copilot.instructions` (a project-owned markdown file of domain rules), rendered by `npx set-copilot prompt`.

## Usage

### `/meeting-copilot start` (or `start --lite` / `start --zero`)

**IMPORTANT: Execute ALL phases sequentially without stopping. Do NOT wait for user input between phases. Do NOT use forks or subagents — do everything inline.**

**Three modes:**
- **`start`** (default) — active lookup: pre-loads the digest, then uses Grep/Read on `knowledge.sources` during the meeting. Slower (~3-8s) but precise.
- **`start --lite`** — pre-loaded context: loads the enriched JSON at Phase 1, then **zero tool calls** during the meeting. Fast (<1s) but limited to pre-loaded knowledge.
- **`start --zero`** — zero-load: **skips Phase 1 entirely**. Works purely from what's already in the conversation context (CLAUDE.md, rules, memory). Fastest start, smallest footprint.

#### Phase 0: Scope the runtime dir (do this in EVERY command below)

Every `set-copilot` command in this skill — `digest`, `prompt`, `path`, `capture`, `poll`,
`stop`, `status` — MUST be prefixed with the same runtime dir:

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}"
```

It is where the keyword index, the transcript, and the PID file live, and every command
reads it back from there. Scope it in one command and not another and they silently talk
past each other: a `capture` in the scoped dir with a `digest` in the default one finds no
keyword index, so no line ever gets a `topics` annotation and the copilot loses its routing.
Byte-identical, every time.

#### Phase 1: Knowledge Pre-load (max 2 minutes)

Regenerate the digest first (pulls fresh keywords/decisions from your configured sources into the runtime dir), then load the project's copilot policy — the alert categories, the engagement level, and any project instructions, all from `set-copilot.config.json`:
```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot digest
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot prompt
```

**The `prompt` output is your analysis policy for this session.** It defines which categories you may speak up about, what triggers each, which ones fire a desktop notification, and any domain rules the project wrote for you. It replaces the default taxonomy in Phase 4 — follow it, not your assumptions about what matters. Run it in every mode, including `--zero`: it is config, not knowledge, and costs one call.

**Normal mode (`start`):** Read the digest, then remember you have Grep/Read access during the meeting:
```bash
cat "$(SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot path digest)"
```
You don't need to memorize everything — know WHAT EXISTS and WHERE. During the meeting, Grep/Read the configured `knowledge.sources` on demand.

**Lite mode (`start --lite`):** Load the enriched context JSON — this replaces ALL grep/read during the meeting:
```
Read the file printed by:  SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot path context
```
It contains: `decisions`, `deferred`, `cards` (per-entity quirks), `domainFaq`, `recentIncidents`. From here on, work exclusively from what's loaded.

**Zero mode (`start --zero`):** Skip Phase 1 entirely — no digest, no reads. Work from conversation context only.

**After loading (or skipping): immediately proceed to Phase 2. Do NOT stop.**

#### Phase 2: Start Capture

ONE Bash call with `run_in_background: true` — the capture plays the rising tone by itself when the mic is live, and self-stops after 2 hours (no separate timer or beep step):

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot capture --max-minutes 120
```

`SET_COPILOT_DIR` scopes the transcript and the PID file to this Claude session and this
project, exactly as `/ds` does for dictation. Without it the capture lands in the shared
`/tmp/set-copilot`, where a reboot eats the meeting and a second Claude session is refused
outright ("a capture is already running"). **Keep it byte-identical in Phase 3 and in
`stop`** — that directory is how they find this capture.

**After starting: immediately proceed to Phase 3. Do NOT stop.**

#### Phase 3: Long-poll Monitor

Do NOT `tail -f` (per-line flood) and do NOT run the poll as a blocking foreground loop. The right shape: `npx set-copilot poll` (long-poll — returns one batch per reaction-worthy event or after ~60s) wrapped in a Monitor. Each non-empty round emits ONE notification you answer as normal chat text; empty rounds emit nothing.

Start the Monitor with `persistent: true` and `timeout_ms: 7200000`:
```bash
while :; do OUT=$(SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot poll 60); if [ -n "$OUT" ]; then printf '%s\n' "$OUT"; fi; case "$OUT" in *capture-dead*) exit 0;; esac; done
```

Then tell the user: "🟢 Meeting Copilot active. Watching and analyzing. `/meeting-copilot stop` to finish." and END YOUR TURN — the Monitor notifications drive everything from here.

Each notification is one batch of JSONL lines:
```json
{"ts": 12345, "speaker": "mic", "text": "...", "final": true, "topics": ["Example Partner", "invoice"], "urgency": "high", "question": true}
{"type": "silence", "duration_ms": 3200, "ts": 12345}
```
- `speaker: "mic"` = you (the person running the copilot); `speaker: "system"` = the other party.
- `topics` = pre-matched keywords (entity names, feature terms, decision ids) from the keyword index. Present only when something matched — use it for instant routing.
- `urgency: "high"` = the text contains problem indicators. Prioritize.
- `question: true` = looks like a question that may need a knowledge-backed answer.
- `type: "silence"` = a pause started — a good moment for a slightly deeper lookup.
- `{"type":"reconnect", "downtime_ms": N}` = the transcription socket dropped and came back. Audio buffered during the gap is replayed, but if `downtime_ms` is large, **words may be missing here** — treat the surrounding text as possibly incomplete, and say so rather than guessing at a half-sentence.
- `{"type":"capture-dead"}` = capture stopped (stop/timeout/crash); the Monitor exits — process remaining lines and give the closing summary.

#### Phase 4: Continuous Analysis

**RESPONSIVENESS — be fast, not cautious:**
1. React in the same round when a topic is recognizable — one sentence is often enough.
2. Use `topics` for instant routing, `urgency` for prioritization, `question` for proactive answers.
3. If a sentence references a known topic (entity, feature, decision, incident), respond NOW with the relevant context. Don't say "listening" or "waiting".
4. **NEVER output filler.** If a batch gives you nothing to add, end the turn with no visible text.
5. **Lookups (normal mode only)** happen while handling a notification — Grep/Read `knowledge.sources` BEFORE writing your final text. In `--lite`/`--zero` you MUST NOT use tools; work from context.

**HOW MUCH TO TALK is config, not your judgement** — the `## Engagement` block from
`npx set-copilot prompt` (Phase 1) decides it: `silent` / `reactive` (a watcher: speak only
when a category fires) / `participant` (a third voice: also confirm, refute, add, answer).
It also sets the per-contribution line limit and whether web research is allowed. Follow it.
Do not import a silence policy from your own instincts, and do not carry one over from
another project.

**ANALYSIS — check every thought unit against the alert categories you loaded in Phase 1** (`npx set-copilot prompt`). Those categories, their triggers, their priorities, and which of them fire a desktop notification ARE the policy: they come from the project's config, so do not substitute a taxonomy of your own. Out of the box they are ⚠ CONTRADICTION (high) / 📋 CONTEXT / ✏ NEW DECISION / ❓ QUESTION (low), but a project may reword them, drop them, or add its own.

**SILENCE — say NOTHING (not even filler)** for anything that fits no category: mundane conversation, greetings, scheduling, repetition of known facts, discussion that doesn't touch the knowledge base, or when unsure. **NO FILLER. EVER.**

**OUTPUT FORMAT** — alerts go into the chat as normal text; keep it SHORT (max 3 lines per alert). With the default categories:
```
⚠ CONTRADICTION: Cutting log deferred to phase 2 (DEC-002, manufacturing.md:100)
  Now being requested in scope. A scope change is needed if this moves in.

📋 CONTEXT: Documentation photos already implemented (logistics.md)
  Driver-app photo upload is in the spec.
```

#### Phase 5 (optional): Mirror analysis to the monitor wall

**Chat is your primary voice; the wall is a secondary artifact.** If a wall is running
(`npx set-copilot wall` in another terminal, or the user asked for it), **you are the wall's
producer** (design D9): the same understanding that produces your chat alerts also produces the
wall's visuals. But the wall must never be your ONLY output — a wall that doesn't visibly update
looks broken, so the chat carries the liveness and the interpretation (this is the `## Feedback`
block from `set-copilot prompt`).

You emit compact structured specs; the wall renders them deterministically (no second model). Push
one event — or a JSON array — per turn:

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot wall-emit '{"category":"súgás","zone":"private","text":"…"}'
```

The `category` values ARE the ones from your Phase-1 policy / the wall config — do NOT invent
a taxonomy here; the mechanic is this command, the categories are config. Guidance:

- **Echo every wall emission in chat.** Whenever you `wall-emit` a graph or chart, also write ONE
  short chat line saying what you understood (the interpretation, not the raw transcript), so the
  wall is never the only sign you acted.
- **Ambiguity is a chat question, not a wall fact.** If the numbers/structure are ambiguous (e.g.
  values given only relatively), state your assumption in chat or ask — do not render a guessed
  value on the wall as if it were fact.
- **Text categories** (súgás, riasztás): emit the SAME short line you'd write in chat. Set
  `zone:"private"` for a note only you should see, `zone:"both"` for something the room may see;
  set `priority:"immediate"` on alerts so the wall shows them at once.
- **A diagram** (an architecture/relationship graph category, e.g. `architektúra`): when the
  discussion builds up a structure, emit a **compact graph delta** — `{"op":"reset"}` to start a
  fresh visual on a topic change, then `{"op":"add","nodes":[…],"edges":[…]}` with only what's
  NEW. Reuse one `visual` id across the deltas of one topic. Emit the spec, never a drawing —
  the client draws it.
- **A chart** (a metric category, e.g. `metrika`): when explicit numbers sharing one dimension
  are spoken, emit `{"type":"bar","title":…,"data":[{"label":…,"value":…}]}`. Never invent
  numbers that weren't said.

A malformed event is dropped with a warning, never crashing capture — so mirror freely and move
on. If no wall is running, skip the emitting — but the chat-feedback rules above (direct address,
ambiguity) still apply.

### `/meeting-copilot stop`

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot stop
```
The Monitor exits on its own (the in-flight poll returns `{"type":"capture-dead"}`). Then report a summary: meeting duration, alert counts by type (⚠/📋/✏/❓), and any new decisions detected (for post-meeting processing).

### `/meeting-copilot status`

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot status
```

## Prerequisites

- `set-copilot` installed (`npx set-copilot init`) and `SONIOX_API_KEY` in `.env`.
- `knowledge.sources` configured in `set-copilot.config.json` (for the cross-referencing; dictation needs none).
- Linux: `parec` + `notify-send`. macOS: `sox` + `osascript` (built in).
