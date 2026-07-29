#!/usr/bin/env bash
# set-copilot — Stop hook that refuses to let a recovery session end with an unfinished
# review claim.
#
# Why a hook and not agent discipline: the same lesson `wall-mirror.sh` records. A prompt
# mandate is POLICY — it ASKS — and a live meeting measured the mirror policy falling behind
# badly enough that it had to be rebuilt structurally. A recovery review is the worse case:
# forgetting to record one means re-reading a whole meeting, or losing the same knowledge a
# second time if a stale status is trusted.
#
# What it does NOT do, deliberately: it never records a completion on the caller's behalf.
# Asserting a review that did not happen is the one failure mode that loses knowledge
# silently. This hook blocks; it never asserts.
#
# It is OPT-IN and self-gating — it does something ONLY when BOTH hold:
#   1. the session opted in   → `<runtimeDir>/recovery.active` exists (the skill creates it)
#   2. a claim is open        → `recovery status --json` reports a dangling claim
# Every other session is untouched, so installing it is harmless.
#
# ---------------------------------------------------------------------------
# The blocking contract (verified against code.claude.com/docs/en/hooks, 2026-07-29):
#   - exit 2  → blocks the stop; STDERR is fed back to Claude as the reason
#   - exit 0 with `{"decision":"block","reason":"…"}` on stdout → the same, structured
#   - any other exit code → non-blocking
# We use exit 2 + stderr: it is the simpler half of the contract and needs no jq on the
# output path.
#
# The Stop input carries NO `stop_hook_active` field (checked — the documented schema is
# session_id / prompt_id / transcript_path / cwd / permission_mode / hook_event_name /
# last_assistant_message / stop_reason). So re-entrance has to be bounded here, or a caller
# that cannot resolve the claim would wedge the session forever. A nudge counter does it:
# the hook blocks up to MAX_NUDGES times, then lets the turn end with a loud warning. That
# is not a silent surrender — the claim stays dangling and `recovery status` reports it
# prominently, which is exactly the state it is meant to be in.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
command -v set-copilot >/dev/null 2>&1 || exit 0

MAX_NUDGES=3

PAYLOAD="$(cat)"
SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty')"
[ -n "$SESSION_ID" ] || exit 0

DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.set/copilot/$SESSION_ID"
[ -f "$DIR/recovery.active" ] || exit 0     # not a recovery session — quietly exit

set +e
STATUS="$(SET_COPILOT_DIR="$DIR" set-copilot recovery status --json 2>/dev/null)"
RC=$?
set -e
# A failed lookup must not block: being unable to ASK whether work is outstanding is not
# evidence that it is. (The opposite of the redaction seam's fail-closed rule, and for the
# opposite reason — nothing is disclosed or lost by letting a turn end here, while wedging
# every session on a broken CLI would be a much larger harm.)
[ "$RC" -eq 0 ] && [ -n "$STATUS" ] || exit 0

OPEN="$(printf '%s' "$STATUS" | jq -r '.dangling // [] | length')"
[ "$OPEN" -gt 0 ] 2>/dev/null || exit 0

NUDGES_FILE="$DIR/recovery-guard.nudges"
NUDGES="$(cat "$NUDGES_FILE" 2>/dev/null || echo 0)"
case "$NUDGES" in ''|*[!0-9]*) NUDGES=0 ;; esac

FILES="$(printf '%s' "$STATUS" | jq -r '.dangling[] | "  - \(.file) (\(.step))"')"

if [ "$NUDGES" -ge "$MAX_NUDGES" ]; then
  # Bounded, and loud. The claim is left open on purpose: `recovery status` will keep
  # reporting it, and the next recovery run resolves it before starting new work.
  printf 'set-copilot: %s recovery claim(s) still open after %s reminders — letting the turn end.\n%s\nThey remain UNFINISHED and will be reported by `set-copilot recovery status`.\n' \
    "$OPEN" "$MAX_NUDGES" "$FILES" >&2
  exit 0
fi

echo $((NUDGES + 1)) > "$NUDGES_FILE"

# exit 2 → the stop is blocked and this stderr text is fed back as the reason.
cat >&2 <<EOF
set-copilot: this recovery session has $OPEN unfinished review claim(s):
$FILES

A claim is not a completion. Resolve each one before ending the turn:
  - delivered the findings:  set-copilot recovery mark <file> --step review --findings-file <json>
                             (pass [] if nothing was missed — that is still a result)
  - could not finish it:     set-copilot recovery abandon <file> --step review --reason "<why>"

If the recovery run is over, also remove the marker: rm "$DIR/recovery.active"
EOF
exit 2
