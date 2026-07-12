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

#### Phase 1: Knowledge Pre-load (max 2 minutes)

Regenerate the digest first (pulls fresh keywords/decisions from your configured sources into the runtime dir), then load the project's copilot policy — the alert categories and any project instructions, both from `set-copilot.config.json`:
```bash
npx set-copilot digest
npx set-copilot prompt
```

**The `prompt` output is your analysis policy for this session.** It defines which categories you may speak up about, what triggers each, which ones fire a desktop notification, and any domain rules the project wrote for you. It replaces the default taxonomy in Phase 4 — follow it, not your assumptions about what matters. Run it in every mode, including `--zero`: it is config, not knowledge, and costs one call.

**Normal mode (`start`):** Read the digest, then remember you have Grep/Read access during the meeting:
```bash
cat "$(npx set-copilot path digest)"
```
You don't need to memorize everything — know WHAT EXISTS and WHERE. During the meeting, Grep/Read the configured `knowledge.sources` on demand.

**Lite mode (`start --lite`):** Load the enriched context JSON — this replaces ALL grep/read during the meeting:
```
Read the file printed by:  npx set-copilot path context
```
It contains: `decisions`, `deferred`, `cards` (per-entity quirks), `domainFaq`, `recentIncidents`. From here on, work exclusively from what's loaded.

**Zero mode (`start --zero`):** Skip Phase 1 entirely — no digest, no reads. Work from conversation context only.

**After loading (or skipping): immediately proceed to Phase 2. Do NOT stop.**

#### Phase 2: Start Capture

ONE Bash call with `run_in_background: true` — the capture plays the rising tone by itself when the mic is live, and self-stops after 2 hours (no separate timer or beep step):

```bash
npx set-copilot capture --max-minutes 120
```

**After starting: immediately proceed to Phase 3. Do NOT stop.**

#### Phase 3: Long-poll Monitor

Do NOT `tail -f` (per-line flood) and do NOT run the poll as a blocking foreground loop. The right shape: `npx set-copilot poll` (long-poll — returns one batch per reaction-worthy event or after ~60s) wrapped in a Monitor. Each non-empty round emits ONE notification you answer as normal chat text; empty rounds emit nothing.

Start the Monitor with `persistent: true` and `timeout_ms: 7200000`:
```bash
while :; do OUT=$(npx set-copilot poll 60); if [ -n "$OUT" ]; then printf '%s\n' "$OUT"; fi; case "$OUT" in *capture-dead*) exit 0;; esac; done
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
- `{"type":"capture-dead"}` = capture stopped (stop/timeout/crash); the Monitor exits — process remaining lines and give the closing summary.

#### Phase 4: Continuous Analysis

**RESPONSIVENESS — be fast, not cautious:**
1. React in the same round when a topic is recognizable — one sentence is often enough.
2. Use `topics` for instant routing, `urgency` for prioritization, `question` for proactive answers.
3. If a sentence references a known topic (entity, feature, decision, incident), respond NOW with the relevant context. Don't say "listening" or "waiting".
4. **NEVER output filler.** If a batch has nothing alert-worthy, end the turn with no visible text.
5. **Lookups (normal mode only)** happen while handling a notification — Grep/Read `knowledge.sources` BEFORE writing your final text. In `--lite`/`--zero` you MUST NOT use tools; work from context.

**ANALYSIS — check every thought unit against the alert categories you loaded in Phase 1** (`npx set-copilot prompt`). Those categories, their triggers, their priorities, and which of them fire a desktop notification ARE the policy: they come from the project's config, so do not substitute a taxonomy of your own. Out of the box they are ⚠ CONTRADICTION (high) / 📋 CONTEXT / ✏ NEW DECISION / ❓ QUESTION (low), but a project may reword them, drop them, or add its own.

**SILENCE — say NOTHING (not even filler)** for anything that fits no category: mundane conversation, greetings, scheduling, repetition of known facts, discussion that doesn't touch the knowledge base, or when unsure. **NO FILLER. EVER.**

**OUTPUT FORMAT** — alerts go into the chat as normal text; keep it SHORT (max 3 lines per alert). With the default categories:
```
⚠ CONTRADICTION: Cutting log deferred to phase 2 (DEC-002, manufacturing.md:100)
  Now being requested in scope. A scope change is needed if this moves in.

📋 CONTEXT: Documentation photos already implemented (logistics.md)
  Driver-app photo upload is in the spec.
```

### `/meeting-copilot stop`

```bash
npx set-copilot stop
```
The Monitor exits on its own (the in-flight poll returns `{"type":"capture-dead"}`). Then report a summary: meeting duration, alert counts by type (⚠/📋/✏/❓), and any new decisions detected (for post-meeting processing).

### `/meeting-copilot status`

```bash
npx set-copilot status
```

## Prerequisites

- `set-copilot` installed (`npx set-copilot init`) and `SONIOX_API_KEY` in `.env`.
- `knowledge.sources` configured in `set-copilot.config.json` (for the cross-referencing; dictation needs none).
- Linux: `parec` + `notify-send`. macOS: `sox` + `osascript` (built in).
