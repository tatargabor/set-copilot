# Design

## D1 — Per-kind command keys stay; the seam and its environment are shared

The plan said a dictation stop should run "the same seam a meeting stop does
(`copilot.handoverCommand`, or the default)". The code already has a dictation seam
(`copilot.dictationHandoverCommand`, e8cdd5c), with a spec scenario that the keys do not cross
paths. Feeding dictations into a meeting-only command would be wrong for the one project that has
exactly that configuration: its script routes by `COPILOT_HANDOVER_SLUG` into client folders or,
absent a slug, into the internal meeting-transcript folder as `<date>-part<N>`, and runs a
`git fetch` first. Every `/dd` would then pay a network round-trip and file a dictation as an
internal meeting part. A pre-existing script cannot honour a kind marker it has never heard of.

So: one function (`runRecordingHandover`) for both kinds, one environment, one failure posture,
one ledger write; the *command* is chosen per kind from the existing keys; an unconfigured kind
goes to the built-in target. A project that wants one script for both sets both keys to it and
branches on `SET_COPILOT_KIND`. The dictation path keeps capturing the child's stdout onto stderr
(the message channel rule).

## D2 — The built-in target

`<toplevel>/docs/inputs/copilot/`, where `<toplevel>` is `git rev-parse --show-toplevel` from the
project root. Outside a git work tree there is nowhere durable to put it: the target is skipped
with a stderr note naming the archive, never created in an arbitrary directory (a `/dd` from `~`
must not grow `~/docs/`).

Names: `<YYYY-MM-DD>-<kind>-part<N>` + `.jsonl` (raw, byte copy), `.md`, `-stitched.jsonl`. The
date is the recording's local date, from the archive name's UTC stamp
(`…-2026-10-05T17-27-54-794Z.jsonl`) or, for a live-named file, its mtime — transcript `ts` values
are offsets, not clock times. `N` is the first number for which none of the three names exists in
the work tree, in `HEAD`, or in the upstream branch's tree (no fetch: a stop must not wait on the
network).

Identity: the raw file's SHA-256, compared against files of the **same byte size** among
`git ls-files --cached --others --exclude-standard` — so the hashing cost is bounded by the
recordings, not the repository. A hit means "already saved", and the whole recording is skipped
(the derived files are reproducible from the raw one).

The engine never runs `git add` or `git commit`. It prints the paths it wrote and a pathspec'd
`git add` line.

## D3 — Dictation gets derived artifacts beside its archive

Today a dictation archive has no `.md`, by design ("the text is a message, not a document"). The
persistence principle overrides that for the *copy*: the readable `.md` must land next to the raw
file. The stitch runs once more on the archived file (`stitchFile`, the same code a meeting uses),
after the text was printed and the file archived, honouring `transcript.stitchOnStop`; its report
goes to stderr. The printed message is unchanged — the derived files never touch stdout.

## D4 — What "saved" means for back-fill: repo content, or a recorded command hand-off

A project command may store a recording in a form the engine cannot recognise (one project turns
each dictation into a Markdown note with frontmatter; no byte-identical copy ever exists). A pure
content test would report its entire history as unsaved, forever, and a session-start nag that is
always on teaches everyone to skip it. So every **successful** command hand-off (exit 0) is
recorded, keyed by the raw file's SHA-256, and back-fill treats a recording as saved when either a
content-identical copy is in the work tree or a successful command hand-off of that content is
recorded. Default-target hand-offs are verified by content alone. A failed command is not
recorded, so the next back-fill retries it.

Consequence, stated plainly: in a project whose command does not keep a byte copy, the first
back-fill hands its whole un-recorded history to that command once (the command must be
idempotent — the one known instance de-duplicates by its own key), and from then on the record
answers.

## D5 — The record is the recovery ledger; the marker sits beside it (review: reuse)

Reuse scan (`reuse-before-build`): `src/recovery-ledger.ts` already keeps an engine-owned,
SHA-256-keyed, append-only, tolerant ledger per project (`.set/copilot/recovery-log.jsonl`), and
`stitchFile` already writes it. A second ledger beside it would be two answers to "what happened to
this transcript". So a hand-off is a third step, `handover` (`state: "done"`, `outcome: { via, kind,
key | targets | existing, backfill? }`), and `readLedger` keeps it. It is deliberately not in
`RECOVERY_STEPS`, so `recovery claim/mark` cannot assert one by hand. The back-fill marker is
`.set/copilot/backfill-last.json`, beside the ledger: runtime state, per machine, never tracked —
the same location assumption the recovery ledger and the recordings themselves already rely on.
(An earlier draft put both under the user config dir; the review's reuse finding replaced that.)

## D6 — What back-fill scans

`<projectRoot>/.set/copilot/`, recursively (depth ≤ 4: one survey found a recording nested under
`<uuid>/.set/copilot/<uuid>/`), for capture outputs as `transcript-stitch-run`'s `isCaptureOutput`
defines them (`transcript*`/`dictation*` `.jsonl`, not `-stitched`). A live name
(`transcript.jsonl`, `dictation.jsonl`) is included only when no capture is alive in its directory
(`captureAlive`); a directory with `replay-run.json` is skipped (a replay of a scenario fixture,
possibly private material). Back-fill **copies**, never renames: "handed over exactly once" belongs
to `stop`'s single `renameSync`, and a later stop of the same content is de-duplicated by content.
A file with no speech line is not a recording. The readable artifacts beside a recording are reused
only when they are at least as new as it (a live-named file is rewritten by the next capture, and a
stale `.md` would describe a different meeting); otherwise they are stitched again. The global
runtime dir (`/tmp/set-copilot`) is not scanned: it is shared by every project.

## D7 — The session-start check

`hooks/recordings-check.sh`, registered by `init` as a `SessionStart` command hook (matched by
script name, like the `Stop` hooks' removal). It resolves `set-copilot` from `PATH`, then from the
project's `node_modules/.bin`, and otherwise exits 0 silently (no `npx`: a session start must never
download a package). It runs `backfill --check` in `$CLAUDE_PROJECT_DIR`, which prints nothing when
everything is saved and one line otherwise — SessionStart stdout is added to the session's context.
It always exits 0. No `timeout(1)` (absent on macOS).

For `backfill --check` and `--dry-run` the config preflight runs as a dry run (review R3): a hook
that fires in every project at every session start must not migrate config files in passing, and a
config that cannot be loaded makes `--check` silent rather than failing the session start.

## D8 — Review outcomes folded in (2026-10-07)

- **Kind from the file (R1).** The SessionEnd hook runs a plain `stop`; a dictation whose session
  ended before `/dd` is archived on the meeting path. The kind is therefore `kindOf(archived)` —
  `dictation*` is a dictation — on both paths, never the flag.
- **Names carry the content hash (R7).** `<date>-<kind>-part<N>-<sha8>`: the repository lives on
  several machines; two machines each saving a different `part1` before pulling would meet in an
  add/add conflict. The plan asked for `<date>-<kind>-part<N>`; the hash suffix is the deviation,
  kept short, with `N` still ordering the day.
- **`.set/` never counts as a saved copy (R5)**, so a project that forgot to ignore `.set/` does
  not match its own archive.
- **No speech, no copy (R8)**; **atomic writes (R12)**: a temp name renamed into place, so a
  SessionEnd hook killed mid-copy leaves no truncated file under a final name.
- **Opting out (R6)** needs no new key: a project that wants no copy configures a no-op command
  (`"dictationHandoverCommand": "true"`). Whether the default should be on for every project is
  recorded as the user's open decision.
- **stdout (R2).** `stop --print` already writes its own process lines (`Stopped capture …`) to
  stdout; the `dd` skill says they arrive on stderr. That pre-existing mismatch is reported, not
  changed here; this change only guarantees that nothing *it* adds reaches stdout.
- **Latency (R15).** A `/dd` now also stitches the archive and, with no dictation command, runs
  `git ls-files --cached --others --exclude-standard` once and hashes only same-size files.
  Measured below in tasks 1.3/2.2.
