---
name: ds
description: Start dictation (shortcut for /dictate start)
user_invocable: true
---

# ds — Start Dictation

Self-contained fast path for `/dictate start` — do NOT invoke the dictate skill (that would cost an extra round-trip). Optional argument: minutes (default **3**); `/ds 10` = 10 minutes.

Run ONE Bash call with `run_in_background: true`:

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}" npx set-copilot capture --mic-only --max-minutes <minutes-or-3>
```

`SET_COPILOT_DIR` scopes the transcript and the PID file to this Claude session (the id matches the conversation history file name), so parallel sessions cannot overwrite each other's recording. Keep it byte-identical in `/dd` — `stop` finds the capture through that same directory.

The capture plays the rising tone by itself when the mic is live, and self-stops at the limit — no separate beep or timer step. Each start archives the previous transcript as `dictation-<timestamp>.jsonl` next to it, so earlier dictations in the session stay readable.

Then tell the user: "🔴 Dictation active (N min limit) — the rising tone means the mic is live. `/dd` to finish." and END YOUR TURN.
