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

**Wall option (`start wall`).** Add the word `wall` (combinable with any mode, e.g. `start --lite wall`) to have the copilot **own the monitor wall**: it launches the wall itself in Phase 2b — scoped to the SAME runtime dir as the capture, on a per-session port, fake-feed off — and tears it down in `stop`. This is the supported way to run the wall; do NOT hand-start `set-copilot wall` in another terminal against a different dir (that split is what makes drawings and transcript point at different places). Without `wall`, no wall is started and Phase 5 simply skips emitting.

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

**After starting: immediately proceed to Phase 2b (if `wall`) then Phase 3. Do NOT stop.**

#### Phase 2b: Start the wall (ONLY if `wall` was in the args)

ONE Bash call with `run_in_background: true`. Derive a per-session port so parallel
sessions do not fight over one (the wall walks to the next free port anyway if it is
taken), and start it in the SAME scoped runtime dir, fake-feed off:

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}"
WALL_PORT=$(( 4180 + $(printf '%s' "${CLAUDE_CODE_SESSION_ID:-shared}" | cksum | cut -d' ' -f1) % 800 ))
SET_COPILOT_DIR="$SET_COPILOT_DIR" npx set-copilot wall --no-fake-feed --port "$WALL_PORT"
```

The wall writes `wall.pid` + `wall.url` into the runtime dir and keeps the process
alive. Read the URL back and tell the user (the bound port may differ from `WALL_PORT`
on fallback), in a **separate, non-background** call:

```bash
sleep 1; cat "$(SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot path wall-url)"
```

Tell the user: "🖥 Wall: <url>" (both the private `/` view and the public `/wall` view
are served there). **After starting: immediately proceed to Phase 3. Do NOT stop.**

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
(started by Phase 2b when the session began with `wall`, or already up for this runtime dir),
the wall must never be your ONLY output — a wall that doesn't visibly update looks broken, so
the chat carries the liveness and the interpretation (the `## Feedback` block from
`set-copilot prompt`). Emit with the SAME scoped `SET_COPILOT_DIR`, so the events reach the
wall this session owns.

**Showing a live web page.** An iframe (`webpage` payload) only works for pages that permit
embedding; news sites, Google, banks, etc. send `X-Frame-Options` / `CSP frame-ancestors` and
render blank. For those, screenshot instead — it works for ANY page:

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot wall-shot <url> [--caption "<text>"]
```

It renders the page with headless Chromium and puts the image on the wall. Prefer `webpage`
for embed-friendly URLs (instant, live); reach for `wall-shot` when the page blocks framing or
a static snapshot is all that is wanted. (Needs Chromium/Chrome installed.)

**The categories, the payload shapes, and when a visual is warranted are NOT in this file.** They
come from the `## Drawing the wall` block of `set-copilot prompt`, which you loaded in Phase 1.
That is deliberate: a producer inherits that block for free (below), so it is paid for once per
session instead of being restated on every drawing. This file owns only the mechanics:

**Spawn a fork to draw.** Don't draw inline — you'd stop talking while you did. Spawn a fork of
yourself (`subagent_type: "fork"`) whose prompt is ONLY the mandate:

> Draw the `<category>` for what we just discussed: <one line of what to show>.
> Emit with `SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot wall-emit '<json>'`, then stop.

The fork inherits this entire conversation — that inheritance IS its grounding, which is why the
mandate can be one line and why it knows what matters. It draws, emits, and exits.

**Spawn a fork only when there is something to compose.** If the content is already settled in this
conversation, `wall-emit` it directly: measured on a live session, a fork costs 16–62 s and 47–76k
tokens per drawing (a fork that reads source files is the slow end), against ~1 s for a direct emit.
A fork earns its cost by reading source or working something out — never by retyping what you
already know.

Rules that keep this cheap and correct:

- **One fork, one category.** Give each fork a single category. If two need updating, spawn two
  forks in the same message — they run concurrently and neither blocks the other.
- **Never pass a `model` override to a producer fork.** A fork always runs on your model and the
  override is ignored; asking for a cheaper tier silently does nothing.
- **Spawn on need, never to wait.** No idling forks polling for work, and never spawn one merely
  to keep a cache warm — that is pure waste.
- **YOU echo, not the fork.** After spawning, write ONE short chat line saying what you understood
  and are having drawn. The fork's output does not reach the chat, so if you don't say it, nothing
  does.
- **Ambiguity is a chat question, not a wall fact.** If the structure or numbers are ambiguous
  (e.g. values given only relatively), state your assumption in chat or ask — never hand a guess
  to a fork to render as established fact. A wall carries authority; don't lend it to a guess.
- **Never invent numbers that weren't said.**

For a one-line text note you may skip the fork and `wall-emit` directly — there is nothing to
compose, so a fork would only add latency.

A malformed event is dropped with a warning, never crashing capture — so mirror freely and move
on. If no wall is running, skip the emitting — but the chat-feedback rules above (direct address,
ambiguity) still apply.

### `/meeting-copilot stop`

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot stop
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot wall-stop
```
Stop both: the capture, and the wall this session started (`wall-stop` is a no-op if none was
started, and only ever stops the wall in THIS runtime dir — never another project's). The
Monitor exits on its own (the in-flight poll returns `{"type":"capture-dead"}`).

`stop` archives the live meeting transcript exactly once (no `--print` — that would replay the
whole transcript into the session as if freshly spoken) and prints the saved path as
`[set-copilot] Transcript saved: <path>`. Capture that line.

Then report a summary: meeting duration, alert counts by type (⚠/📋/✏/❓), any new decisions
detected, and the **saved transcript path** from that line (so a post-meeting step can find the
full transcript).

### `/meeting-copilot status`

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot status
```

## Prerequisites

- `set-copilot` installed (`npx set-copilot init`) and `SONIOX_API_KEY` in `.env`.
- `knowledge.sources` configured in `set-copilot.config.json` (for the cross-referencing; dictation needs none).
- Linux: `parec` + `notify-send`. macOS: `sox` + `osascript` (built in).
