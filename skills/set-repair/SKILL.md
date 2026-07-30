---
name: set-repair
description: Inspect set-copilot runtime state for faults — orphaned capture PIDs, transcripts never handed over, stale wall claims, archives with no stitched artifacts
user_invocable: true
---

# set-repair — runtime state check

`doctor` probes the **audio chain** (binary → device → bytes → signal). This inspects
**runtime state**: what the PID files, transcripts and wall claims in this project's runtime
dirs say, and whether they are telling the truth. The two do not overlap; run whichever
matches the symptom.

It ends by handing off: anything about a transcript's *content* belongs to
`/transcript-recover`.

## Rules that apply to everything below

- **Check liveness before calling any claim stale.** A PID file means nothing until you have
  probed the process (`kill -0 <pid>` — signal 0 tests reachability without signalling). A dir
  with a running capture or wall is **in use**: report it and leave it alone.
- **Fix only through existing paths.** An unconsumed transcript is handed over by
  `set-copilot stop`, never by moving the file yourself — the single `renameSync` in the
  handover is the source of truth for "handed over exactly once", and a hand-made copy would
  break it. Never rotate a live wall's event log; `wall --reset` exists and checks first.
- **Report anything destructive, never run it.** Print the exact command and let the operator
  decide. This includes deleting a PID file, rotating a log, and re-stitching with `--force`.
- **A clean project reports clean.** Do not invent work.

## Phase 1 — enumerate

```bash
ls -d .set/copilot/*/ 2>/dev/null            # per-session runtime dirs
ls -d /tmp/set-copilot 2>/dev/null           # the unscoped global dir, if it was ever used
```

For each dir, look at: `capture.pid`, `capture.output`, `transcript.jsonl` /
`dictation.jsonl` (live names), the `*-<timestamp>.jsonl` archives, `wall.pid`,
`wall-events.jsonl`, `mirror.pid`, and whether each archive has a `.md` + `-stitched.jsonl`
beside it.

## Phase 2 — the five faults

**1. Orphaned `capture.pid`.** The file exists and the process does not.

- Evidence: the PID, and that `kill -0` fails for it.
- Consequence: a new capture in this dir is *refused* while the stale file stands — the
  refusal exists so a live capture is never orphaned, but here it blocks work for nothing.
- Report: `rm <dir>/capture.pid` — but only after confirming there is also no live-named
  transcript still being written (fault 2 first).

**2. A transcript that was never handed over.** A live-named `transcript.jsonl` or
`dictation.jsonl` with content, and no running capture.

- This is the expensive one. A real project held a 539-line `transcript.jsonl` — an entire
  meeting — that nothing had ever consumed, and it was noticed by accident.
- Evidence: line count, mtime, and that no capture is alive for the dir.
- Fix, through the existing path:
  ```bash
  SET_COPILOT_DIR=<dir> set-copilot stop           # meeting: archives, stitches, reports paths
  SET_COPILOT_DIR=<dir> set-copilot stop --print   # dictation: prints the text, then archives
  ```
  Use `--print` only if the text is still wanted as a message — it is handed over exactly once.

**3. Stale `wall.pid`.** The file exists, the process does not.

- Consequence: `set-copilot wall` refuses to start for that dir.
- Report: `rm <dir>/wall.pid`. If the wall IS alive, say so and stop — do not touch the dir,
  and never rotate `wall-events.jsonl` under a running wall.

**4. Orphaned `mirror.pid`.** The file exists and the process does not — or it exists and the
process IS alive in a dir whose session ended.

- Consequence of a stale file: `set-copilot mirror-follow` refuses to start for that dir, so
  the next session in it mirrors nothing, silently. Consequence of a live orphan: it keeps
  emitting into a wall log after the session that owned it is gone.
- Report: `rm <dir>/mirror.pid` when the process is dead; when it is alive, name the pid and
  `kill` it only if the operator confirms the session is over — `set-copilot stop` is the
  path that stops it properly, and it drains what is pending first.
- Also worth reading here: `wall-mirror.log`. It says, per message, what the mirror decided
  (`emit` / `filler` / `short` / `dup` / `error` / `reset`). "The wall went quiet" and "the
  mirror suppressed everything" are different faults and this is what tells them apart.

**5. An archived transcript with no stitched artifacts.** A `*-<timestamp>.jsonl` with no
`.md` and no `-stitched.jsonl` beside it.

- Fix: `set-copilot transcript --input <dir> --stats`. Already-stitched inputs are skipped
  automatically, so running it over a whole dir is safe and cheap.

## Phase 3 — report

For each runtime dir, one of:

- `in use` — a live capture or wall (name which, and its PID).
- `clean` — nothing to do.
- the faults found, each with its evidence and its suggested command.

Then the handoff:

```bash
set-copilot recovery status
```

Close with how many transcripts remain **unreviewed**, and name the next step:

> N transcript still has no content review. Run `/transcript-recover` to read them for what
> was said that never reached the notes.

If `recovery status` reports unfinished claims, surface them here too — a dangling claim is a
review someone started and did not finish, and it is exactly the kind of state this check
exists to make visible.
