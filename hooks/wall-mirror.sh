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

# Content policy — filler suppression, length cap, code-block handling — comes from
# `copilot.mirror` config and is APPLIED BY THE CLI, not here. This script used to hold the
# judgement itself: an awk pass that discarded every fenced code block (most of a coding
# copilot's message) and a bare 40-character floor. Both are project-specific decisions, and
# the filler phrases are Unicode-anchored regexes — re-implementing that in bash would give
# one policy two implementations, free to disagree.
#
# `--apply` exits 3 for "not wall material" — a DISTINCT code, because a crashing Node
# exits 1 and must not be mistaken for "this was filler" (that would drop mirroring
# silently, the exact class of failure this project keeps closing).
# `set +e` around it: under `set -e` the failing command substitution would take the whole
# hook down before the fallback below could run.
set +e
POLICED="$(printf '%s' "$TEXT" | SET_COPILOT_DIR="$DIR" set-copilot mirror-policy --apply 2>/dev/null)"
POLICY_RC=$?
set -e

if [ "$POLICY_RC" -eq 3 ]; then
  exit 0                                    # the policy classified it as not wall material
elif [ "$POLICY_RC" -ne 0 ] || [ -z "$POLICED" ]; then
  # The lookup itself failed (no CLI, a broken config, anything). Mirroring is a display
  # convenience: losing it silently because a policy lookup failed is worse than mirroring
  # with the built-in constants, so fall back to them and mirror anyway. Note this is the
  # OPPOSITE of the redaction seam's fail-closed rule, and for the opposite reason —
  # nothing is disclosed by mirroring with default filtering.
  TEXT="$(printf '%s' "$TEXT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | sed '/^$/d')"
  [ "${#TEXT}" -ge 40 ] || exit 0
  [ "${#TEXT}" -le 600 ] || TEXT="${TEXT:0:597}…"
else
  TEXT="$POLICED"
fi

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
