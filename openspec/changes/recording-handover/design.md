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
content test would report its entire history as unsaved, forever, and a session-start nag that
is always on teaches everyone to skip it. So the engine records every **successful** command
hand-off (exit 0) in a machine-local ledger, keyed by the raw file's SHA-256, and back-fill treats
a recording as saved when either a content-identical copy is in the work tree or the ledger holds
a successful command hand-off of that content. Default-target hand-offs are verified by content
alone (the copy is byte-identical by construction). A failed command is not recorded, so the next
back-fill retries it.

Consequence, stated plainly: in a project whose command does not keep a byte copy, the first
back-fill hands its whole un-ledgered history to that command once (the command must be
idempotent — the one known instance de-duplicates by its own key), and from then on the ledger
answers.

## D5 — Machine-local state lives under the user config directory

`<userConfigDir>/handover/<project-slug>.jsonl` (ledger) and `<project-slug>.last-backfill.json`
(marker: when it ran, which recordings it handed over, via what, to where). The slug is the
project's absolute root with separators replaced, as Claude Code names its project dirs. Not the
project's `.set/` — a project that forgot to ignore `.set/` would start tracking it — and never a
tracked path. `SET_COPILOT_HOME` relocates it for tests.

## D6 — What back-fill scans

`<projectRoot>/.set/copilot/`, recursively (depth ≤ 4: one survey found a recording nested under
`<uuid>/.set/copilot/<uuid>/`), for `dictation*.jsonl` and `transcript*.jsonl`, excluding
`*-stitched.jsonl`. A live name (`transcript.jsonl`, `dictation.jsonl`) is included only when no
capture is alive in its directory (`captureAlive`). Back-fill **copies**, never renames: the
runtime-dir invariant "handed over exactly once" belongs to `stop`'s single `renameSync`, and a
later stop of the same content is de-duplicated by content. A file with no speech line (empty, or
only `silence`/`reconnect` events) is not a recording and is not counted. The global runtime dir
(`/tmp/set-copilot`) is not scanned: it is shared by every project and its recordings cannot be
attributed to this one.

## D7 — The session-start check

`hooks/recordings-check.sh`, registered by `init` as a `SessionStart` command hook. It resolves
`set-copilot` from `PATH`, then from the project's `node_modules/.bin`, and otherwise exits 0
silently (no `npx`: a session start must never download a package). It runs `backfill --check`
in `$CLAUDE_PROJECT_DIR`, which prints nothing when everything is saved and one line otherwise —
SessionStart stdout is added to the session's context, so that line is how the agent learns of
it. It always exits 0. POSIX `sh`-compatible bash, no `timeout(1)` (absent on macOS); the check
itself is bounded by D2's size prefilter.
