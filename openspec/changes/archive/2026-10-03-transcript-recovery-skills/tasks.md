## 1. The ledger (`src/recovery-ledger.ts`)

- [x] 1.1 Define the entry type: `fingerprint`, `step` (`"stitch" | "review"`), `at` (ISO),
      `version` (stitch algorithm version), `path` (hint only, never matched on), and an
      outcome payload (e.g. sentence count, findings count).
- [x] 1.2 `fingerprint(file)` — SHA-256 of the file contents via `node:crypto`. Path is never
      part of the key.
- [x] 1.3 `ledgerPath(cfg)` → `<projectRoot>/.set/copilot/recovery-log.jsonl`; created lazily on
      first append, directory included.
- [x] 1.4 `readLedger(path)` — tolerant append-only read: skip blank/malformed lines, return the
      entries. A missing file is an empty ledger, not an error.
- [x] 1.5 `appendEntry(path, entry)` — append one JSON line. Never rewrite, never delete.
- [x] 1.6 `isDone(entries, fingerprint, step)` and `entriesFor(fingerprint)` — the query surface
      the CLI and the skills use.
- [x] 1.7 `STITCH_VERSION` constant, bumped when the algorithm changes; exported so a report can
      name it.

## 2. Wiring the ledger into the stitch

- [x] 2.1 `stitchFile` records a `stitch` entry on success — engine-owned, no caller opt-in. No
      entry on failure or on a no-op (nothing to stitch).
- [x] 2.2 `set-copilot transcript` skips inputs whose `stitch` step is already recorded, and
      reports how many it skipped.
- [x] 2.3 `--force` performs the step anyway and appends a NEW entry (history preserved).
- [x] 2.4 The batch report names how many skipped entries predate `STITCH_VERSION`, so the
      operator can decide about `--force`. Never redo automatically.
- [x] 2.5 Verify the stop-time stitch records its entry through the same path (no separate
      write), so a later recovery run does not redo it.

## 3. `set-copilot recovery` command

- [x] 3.1 `recovery status [--input <dir|glob>]` — per transcript, per step: pending / done /
      done-under-older-version / **claimed-but-unfinished**. Dangling claims are reported
      prominently, not folded into the pending count. Read-only: appends nothing, stitches nothing.
- [x] 3.2 `recovery status --json` — the machine shape the skills consume, so a skill never
      parses human text. Includes whether the enforcement hook is installed.
- [x] 3.3 `recovery claim <file> --step review` — appends a claim entry. A claim is NOT a
      completion and must never be reported as done.
- [x] 3.4 `recovery mark <file> --step review [--findings-file <json> | stdin]` — the delivery
      channel for the review's findings AND the completion record, written by one act. Recording
      the count in the entry; the findings themselves stay out of the ledger.
- [x] 3.5 `recovery abandon <file> --step review [--reason <text>]` — resolves a claim without
      completing it; the transcript returns to pending and the attempt stays in the history.
- [x] 3.6 Reject an unknown step, a missing file, and a `mark` with no findings payload with a
      clear message rather than recording a bad entry.
- [x] 3.7 Add all subcommands to `printHelp()` and to the header comment in `src/cli.ts`.

## 3b. Completion enforcement (`hooks/recovery-guard.sh`)

- [x] 3b.1 Write the `Stop` hook, modelled on `hooks/wall-mirror.sh`: gate on a marker file so it
      is a silent no-op for every session that is not recovering; exit quietly when `jq` or
      `set-copilot` is absent, exactly as wall-mirror does.
- [x] 3b.2 On an open claim, BLOCK the stop and feed back which transcript is unfinished and the
      two ways out (`recovery mark` / `recovery abandon`). Confirm the exact Stop-hook blocking
      contract (exit code vs. JSON `decision`) against the Claude Code hook docs before relying
      on it — do not guess.
- [x] 3b.3 The hook NEVER records a completion on the caller's behalf. Asserting a review that
      did not happen is the one failure mode that loses knowledge silently.
- [x] 3b.4 Register it in `init` alongside the wall-mirror hook, reusing `registerStopHook` (which
      is already idempotent and preserves other hooks).
- [x] 3b.5 The recovery skill creates the marker when it starts and removes it when it finishes,
      mirroring how `meeting-copilot` manages `wall-mirror.enabled`.
- [x] 3b.6 Verify the hook is inert when set-copilot is installed but no recovery is running
      (a normal session must not be blocked).

## 4. Ledger tests (`src/recovery-ledger.test.ts`)

- [x] 4.1 A second run over the same input does nothing; a new file in the same directory is
      still processed.
- [x] 4.2 `--force` redoes the work and leaves BOTH entries in the ledger.
- [x] 4.3 One step done does not imply another: stitched-but-unreviewed reports as pending review.
- [x] 4.4 A renamed/moved file is recognised; two identical copies are one transcript; changed
      content is a new transcript.
- [x] 4.5 A malformed ledger line is skipped, not fatal; a missing ledger means everything pending.
- [x] 4.6 An older-version entry counts as done and is COUNTED in the report, never redone.
- [x] 4.7 A failed / no-op stitch records nothing.
- [x] 4.8 `recovery status` mutates nothing (ledger byte-identical, no artifacts written).
- [x] 4.9 A claim is not a completion: a claimed-only transcript reports as dangling, NOT done,
      and its work still counts as outstanding.
- [x] 4.10 `abandon` returns the transcript to pending and leaves both the claim and the
      abandonment in the history.
- [x] 4.11 A dangling claim does not block a later attempt: a subsequent claim + mark completes it.
- [x] 4.12 `mark` without a findings payload is rejected — the record cannot be written without
      the result it is supposed to carry.

## 5. `skills/transcript-recover/SKILL.md`

- [x] 5.1 Frontmatter (`name`, `description`, `user_invocable: true`) matching the existing
      skills' shape.
- [x] 5.2 Discovery phase: per-session runtime dirs + hand-filed recording directories; explain
      that non-conventional names need an explicit glob and that `wall-events.jsonl` is not a
      transcript.
- [x] 5.3 Consult `recovery status --json` FIRST and act only on what is pending — the expensive
      read must never repeat. Resolve any dangling claim before starting new work.
- [x] 5.3b Create the enforcement marker at start, remove it at the end. If the hook is not
      installed (no `init` in this project), SAY SO — the operator must not assume a bookkeeping
      guarantee that is not there.
- [x] 5.4 Stitch the pending inputs; collect `--stats`.
- [x] 5.5 Grading rules (judgement, so they live here not in engine code): reliable / suspect /
      unusable, with the thresholds and what each grade means for trusting the text.
- [x] 5.6 Detect and state the two limits: more than one speaker on a channel (with how to spot
      it — interleaved fragments, high guessed/glued), and a recording split across files being
      two separate timelines.
- [x] 5.7 The review pass: read each pending transcript against the project's notes and knowledge
      base; report what was said that never reached them, quoted, with timestamps, and with the
      grade's caveat attached.
- [x] 5.8 `recovery claim` BEFORE reading each transcript; deliver the findings THROUGH
      `recovery mark --findings-file` when done — the report shown to the operator is derived from
      what was submitted, never produced alongside it. A review that cannot be finished is
      `recovery abandon`-ed explicitly, never left hanging.
- [x] 5.9 Output shape: per-file grade table, then findings, then what remains pending.

## 6. `skills/set-repair/SKILL.md`

- [x] 6.1 Frontmatter matching the existing skills.
- [x] 6.2 Detect: dead `capture.pid`, live-named transcript with no running capture, dead
      `wall.pid`, archive with no stitched artifacts. Report the evidence for each.
- [x] 6.3 Liveness check before reporting any claim stale (signal-0 probe); a dir with a running
      capture or wall is reported as in use and left alone.
- [x] 6.4 Fix only through existing paths: an unconsumed transcript is handed over by `stop`, not
      by a new mechanism. Never rotate a live wall's log.
- [x] 6.5 Anything destructive is reported with the suggested command, never executed.
- [x] 6.6 A clean project reports clean; do not invent work.
- [x] 6.7 End by naming how many transcripts remain unreviewed and handing off to
      `/transcript-recover`.

## 7. Packaging and docs

- [x] 7.1 Update `init`'s summary line to name the new skills (the copy loop already picks up any
      directory under `skills/`) and to report the recovery-guard hook registration.
- [x] 7.2 Confirm the new skill directories AND `hooks/recovery-guard.sh` ship in the npm package
      (`files` in `package.json`).
- [x] 7.3 Export the ledger surface from `src/index.ts`.
- [x] 7.4 `CLAUDE.md`: the ledger in the architecture section, and the two new skills in the
      Skills section — including WHY the ledger is engine-owned rather than prompt-owned, and why
      completion is hook-enforced (the same lesson `wall-chat-mirror` learned in the field).

## 8. Verification

- [x] 8.1 `npm test` green, `npm run build` (tsc strict) clean.
- [x] 8.2 End-to-end on a scratch copy: run `transcript` twice over a directory — second run does
      nothing; add a file — only that one is processed; `--force` — everything redone and both
      entries present.
- [x] 8.3 `recovery status` against a real project archive (read-only, on copies) and confirm the
      pending/done split matches what is on disk.
- [x] 8.4 Run `/set-repair` against the real `consumer-f` runtime dirs and confirm it finds the
      orphaned 539-line `transcript.jsonl` in `a3337b3c` and reports the other dirs clean.

## Deviations and what verification actually found

- **3b.2 — the Stop input has no `stop_hook_active` field.** Checked against
  code.claude.com/docs/en/hooks (2026-07-29): the documented schema is
  session_id / prompt_id / transcript_path / cwd / permission_mode / hook_event_name /
  last_assistant_message / stop_reason. Without it, re-entrance has to be bounded in the hook
  itself or a caller that cannot resolve the claim wedges the session forever — hence
  `MAX_NUDGES=3`, then the turn is allowed to end with a loud warning and the claim left open.
  Verified live: blocks with `exit 2` three times, exits 0 from the fourth on, and goes quiet
  the moment the claim is `mark`ed.
- **8.3 found a real gap and it was fixed, not recorded as a caveat.** Against a copy of a real
  project's archive, 4 of 33 transcripts had their `.md` + `-stitched.jsonl` on disk from before
  the ledger existed, and status reported all 33 as untouched. Reporting work that plainly
  happened as not-happened is the one thing this command exists to prevent, so `recovery status`
  gained an `artifacts` state (`stitchArtifactsExist`, `artifactsOnly` in `--json`): neither
  pending nor done, because the algorithm version is unknown. The delta's
  "A missing ledger means everything is pending" scenario was reworded accordingly and a new
  scenario added. The *skip* logic is deliberately unchanged and stays ledger-only — a legacy
  `.md` was written by an unknown, probably older stitch, so redoing it is the right default and
  is what puts it in the ledger.
- **8.3 also fixed the path display.** The global runtime dir printed as
  `../../../../../set-copilot/transcript.jsonl`, which reads like a project file; a path outside
  the project root is now absolute.
- **8.4 — the orphan is real, and there are two of them.** `consumer-f/.set/copilot/a3337b3c…`
  holds a live-named `transcript.jsonl` of 692 lines, **539 of them speech** (the rest `silence`
  events) — the number the proposal names, confirmed exactly. A second, previously unknown orphan
  sits in `6004ced3…`: 533 speech lines, last written 2026-07-28. Neither dir has a capture
  process, and no `capture.pid` or `wall.pid` is stale anywhere in that project.
- **8.4 — "the other dirs are clean" was too optimistic.** They hold no stale PIDs, but 8 archived
  transcripts across 5 dirs have no stitched artifacts (fault 4). That is `set-repair`'s cheapest
  finding and it is correctly reported rather than being silently treated as clean.
- Every real-archive check ran on copies; both copies were `diff -rq`-identical to their
  originals afterwards, which is also the field proof for 4.8 (`status` mutates nothing).
