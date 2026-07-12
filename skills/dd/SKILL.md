---
name: dd
description: Stop dictation (shortcut for /dictate stop)
user_invocable: true
---

# dd — Stop Dictation

Self-contained fast path for `/dictate stop` — do NOT invoke the dictate skill (that would cost an extra round-trip).

Run ONE Bash call (stop plays the falling tone and waits for the transcript flush):

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot stop --print
```

`SET_COPILOT_DIR` must match the one `/ds` used — that directory holds this session's PID file and transcript. Without it, `stop` would look in the global runtime dir and could kill another session's capture.

`--print` emits the transcript and archives it in one step, so it is handed over exactly once: a second `/dd` prints nothing instead of replaying the previous dictation as if it were freshly spoken. It also prints a transcript left behind by a capture that already self-stopped on its time limit.

Parse the JSONL lines: concatenate the `text` fields of `final: true` lines into one block; skip `{"type":"silence"}` lines and ignore any `topics` field.

Treat the concatenated text as the user's message — act on it. Do NOT echo it back. Respond in the language the user dictated in. If no text was captured, say: "Dictation stopped, no text captured."
