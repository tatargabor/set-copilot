#!/usr/bin/env bash
# recordings-check.sh — set-copilot SessionStart hook (recording-handover).
#
# Tells the session when this machine holds recordings under .set/copilot/ that have no saved
# copy in the repository — the silent loss a gitignored runtime dir produces. It only REPORTS:
# `set-copilot backfill --check` prints one line when something is unsaved and nothing
# otherwise; SessionStart stdout reaches the session's context, so that line is the message.
#
# Never fails a session start: every path exits 0. It never downloads anything (no npx): it
# uses a set-copilot on PATH, else the project's own node_modules/.bin, else stays silent.
# No timeout(1) — it does not exist on macOS; the check bounds itself (it hashes only files
# whose size matches a recording).

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$dir" 2>/dev/null || exit 0
[ -d .set/copilot ] || exit 0

if command -v set-copilot >/dev/null 2>&1; then
  bin="set-copilot"
elif [ -x "$dir/node_modules/.bin/set-copilot" ]; then
  bin="$dir/node_modules/.bin/set-copilot"
else
  exit 0
fi

"$bin" backfill --check 2>/dev/null
exit 0
