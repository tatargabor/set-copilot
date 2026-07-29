---
name: dictate
description: Voice dictation — speak into the mic, text arrives as if you typed it
user_invocable: true
---

# Dictate Skill

Voice input into Claude Code. You speak into the microphone; the text arrives as if you had typed it. Powered by `set-copilot` (Soniox STT). Language follows `set-copilot.config.json` (`language`).

**Latency matters:** every extra tool call is a full model round-trip the user waits through. Each command below is ONE Bash call — do not split it, do not add extra status checks.

## Usage

### `/dictate start [minutes]`

Arguments: optional `minutes` — recording limit. Default: **10**. Example: `/dictate start 3`.

Run ONE Bash call with `run_in_background: true` (capture plays the rising tone by itself when the mic is live, and self-stops at the limit — no separate timer or beep step):

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot capture --mic-only --max-minutes <minutes>
```

Then tell the user: "🔴 Dictation active (N min limit) — the rising tone means the mic is live. `/dd` to finish." and END YOUR TURN.

### `/dictate stop`

Run ONE Bash call (stop plays the falling tone and waits for the transcript flush):

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot stop --print
```

`SET_COPILOT_DIR` scopes the transcript and the PID file to this Claude session (the id is the same UUID the conversation history file uses), so parallel sessions cannot overwrite each other's recording — and it must be identical in `start` and `stop`.

`--print` emits the transcript and archives it as `dictation-<timestamp>.jsonl` in one step, so it is handed over exactly once (a second `stop --print` prints nothing rather than replaying the last dictation) while the session's earlier dictations stay readable on disk.

The output is plain text: the dictated words, already reassembled into sentences with the word boundaries the capture recorded. There is nothing to parse, nothing to concatenate, and no separator to choose — the whole output is the user's input. Act on it.

**Rules:**
- Treat the text as the user's message — answer questions, run commands, write code, whatever it asks.
- Do NOT echo back or confirm what was said — just act on it.
- Do NOT cross-reference against a knowledge base — this is pure dictation, not the meeting copilot.
- Respond in the language the user dictated in.
- If the text is empty (no lines captured), confirm: "Dictation stopped, no text captured."

### `/dictate status`

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot status
```

## Prerequisites

- `set-copilot` installed (`npx set-copilot init` was run in this project).
- `SONIOX_API_KEY` in `.env`.
- Linux: `parec` (PipeWire/PulseAudio). macOS: `sox` (`brew install sox`).
- First-time setup: `npx set-copilot sources` → set `audio.micSource`, then verify with `npx set-copilot doctor`.
