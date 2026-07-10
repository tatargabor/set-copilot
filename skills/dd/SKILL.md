---
name: dd
description: Stop dictation (shortcut for /dictate stop)
user_invocable: true
---

# dd — Stop Dictation

Self-contained fast path for `/dictate stop` — do NOT invoke the dictate skill (that would cost an extra round-trip).

Run ONE Bash call (stop plays the falling tone and waits for the transcript flush):

```bash
npx set-copilot stop; cat "$(npx set-copilot path dictation)"
```

Parse the JSONL lines: concatenate the `text` fields of `final: true` lines into one block; skip `{"type":"silence"}` lines and ignore any `topics` field.

Treat the concatenated text as the user's message — act on it. Do NOT echo it back. Respond in the language the user dictated in. If no text was captured, say: "Dictation stopped, no text captured."
