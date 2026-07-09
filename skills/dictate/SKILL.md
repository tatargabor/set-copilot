---
name: dictate
description: Voice dictation — speak into the mic, text arrives as if you typed it
user_invocable: true
---

# Dictate Skill

Voice input into Claude Code. You speak into the microphone; the text arrives as if you had typed it. Powered by `set-copilot` (Soniox STT). Language follows `set-copilot.config.json` (`language`).

## Usage

### `/dictate start [minutes]`

**Execute ALL steps without stopping. Do NOT use forks.**

Arguments: optional `minutes` — how long to record. Default: **3 minutes**. Example: `/dictate start 10`. Compute `timeout_seconds = minutes * 60`.

1. Start capture in mic-only (dictation) mode with `run_in_background: true`:
```bash
npx set-copilot capture --mic-only
```

2. Start an auto-kill timer in the background that stops capture after the timeout:
```bash
sleep <timeout_seconds> && npx set-copilot stop && echo "Dictation timeout reached"
```

3. Signal that recording started, then tell the user:
```bash
npx set-copilot beep
```
Tell the user: "🔴 Dictation active (N min limit). Speak — `/dictate stop` to finish."

That's it — NO Monitor needed. The transcript collects in a JSONL file and is read on stop.

### `/dictate stop`

1. Stop capture (this also plays the stop chime) and kill the auto-kill timer:
```bash
npx set-copilot stop; pkill -f "slee[p].*set-copilot stop" 2>/dev/null
```

2. Read the dictation JSONL:
```bash
cat "$(npx set-copilot path dictation)"
```

3. Parse the JSONL lines:
```json
{"ts": 12345, "speaker": "mic", "text": "This is the dictated text.", "final": true}
```

Concatenate all `text` fields from `final: true` lines into one block. **Skip `{"type":"silence"}` lines entirely** and ignore any `topics` field. Then treat the concatenated text as the user's input — act on it.

**Rules:**
- Treat the text as the user's message — answer questions, run commands, write code, whatever it asks.
- Do NOT echo back or confirm what was said — just act on it.
- Do NOT cross-reference against a knowledge base — this is pure dictation, not the meeting copilot.
- Respond in the language the user dictated in.
- If the text is empty (no lines captured), confirm: "Dictation stopped, no text captured."

### `/dictate status`

```bash
npx set-copilot status
```

## Prerequisites

- `set-copilot` installed (`npx set-copilot init` was run in this project).
- `SONIOX_API_KEY` in `.env`.
- Linux: `parec` (PipeWire/PulseAudio). macOS: `sox` (`brew install sox`).
