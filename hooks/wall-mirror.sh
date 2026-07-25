#!/usr/bin/env bash
# set-copilot — Stop hook that mirrors the last assistant message onto the monitor wall
# as a `tükör` (mirror) text event.
#
# Why a hook and not agent discipline: the `wall-chat-mirror` prompt mandate is POLICY —
# it ASKS the copilot to mirror — with no enforcement. Measured on a live meeting, that
# policy repeatedly fell behind (the chat carried far more than the wall). This hook closes
# the gap structurally: whatever the copilot said last is mirrored, every turn, or nothing.
#
# It is OPT-IN and self-gating — it does something ONLY when BOTH hold for the session:
#   1. a wall is running for it            → `<runtimeDir>/wall.pid` exists
#   2. mirroring was turned on for it      → `<runtimeDir>/wall-mirror.enabled` exists
# The meeting-copilot skill creates the marker when started with `mirror`; without it (the
# default) this hook is a no-op, so installing it is harmless for non-mirroring sessions.
#
# The marker file's contents, if non-empty, are the category to emit under (default `tükör`).
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
command -v set-copilot >/dev/null 2>&1 || exit 0

PAYLOAD="$(cat)"
SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty')"
TRANSCRIPT="$(printf '%s' "$PAYLOAD" | jq -r '.transcript_path // empty')"

[ -n "$SESSION_ID" ] || exit 0
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || exit 0

DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.set/copilot/$SESSION_ID"
[ -f "$DIR/wall.pid" ] || exit 0            # no wall for this session — quietly exit
MARKER="$DIR/wall-mirror.enabled"
[ -f "$MARKER" ] || exit 0                  # mirroring not opted in — quietly exit
CATEGORY="$(cat "$MARKER" 2>/dev/null || true)"; [ -n "$CATEGORY" ] || CATEGORY="tükör"

# The last assistant message's text blocks, concatenated.
TEXT="$(jq -rs '
  [ .[]
    | select(.type == "assistant")
    | .message.content[]?
    | select(.type == "text")
    | .text
  ] | last // empty
' "$TRANSCRIPT" 2>/dev/null || true)"

[ -n "$TEXT" ] || exit 0

# A code block is noise on the wall: strip the fenced blocks, keep the prose around them.
TEXT="$(printf '%s' "$TEXT" | awk '
  /^[[:space:]]*```/ { inblock = !inblock; next }
  !inblock { print }
')"
TEXT="$(printf '%s' "$TEXT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | sed '/^$/d')"

# Filler filter: short acknowledgements ("Csend.", "Done", "Ok") are not wall material.
# Measured 2026-07-25: without this the hook put "Csend." on the wall and viewers read it
# as a real message.
[ "${#TEXT}" -ge 40 ] || exit 0

[ "${#TEXT}" -le 600 ] || TEXT="${TEXT:0:597}…"

# Dedup: the same message must not go out twice (a manual hook test run and the self-firing
# run can overlap — measured 2026-07-25).
STAMP="$DIR/wall-mirror.last"
HASH="$(printf '%s' "$TEXT" | cksum | cut -d' ' -f1)"
[ "$(cat "$STAMP" 2>/dev/null || true)" != "$HASH" ] || exit 0
printf '%s' "$HASH" > "$STAMP"

# `both` (not `public`): the private view sees it too, marked if the server redacted the
# public variant — so the operator can tell what the audience actually got. Redaction runs
# server-side in `ingest`, so this path never bypasses it.
SET_COPILOT_DIR="$DIR" set-copilot wall-emit \
  "$(jq -cn --arg c "$CATEGORY" --arg t "$TEXT" '{category:$c,zone:"both",text:$t}')" >/dev/null 2>&1 || true

exit 0
