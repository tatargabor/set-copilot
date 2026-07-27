## Why

A capture's line boundaries (sentence end / own 3s silence / 80-token overflow) do not
produce sentences — they produce fragments, and with two overlapping channels they cut
*mid-word*. Measured on real recordings: 51% of lines start mid-sentence before the
`a30d12f` capture fix, still 38% after it, at a median line length of 22–24 characters.
The fix bounded the damage; it cannot remove it, because the writer flushes on time and
size, not on meaning.

The cost is not cosmetic. In `consumer-f` a client fact — where the client stores
their documents — was written across six fragments interleaved with the other channel,
the note-taking LLM read it as noise, and it reached neither the meeting notes nor the
knowledge wiki. Two weeks later a demo turned on exactly that question while the answer
sat in the recording the whole time.

`a30d12f` added `startTs` / `partial` / `cont` / `midWord` precisely so the flush
boundaries would be reversible — but **no consumer reads them**. Today a set-copilot
user has to write their own script to read their own recording. This change supplies the
missing consumer-side step, and makes it the default artifact so nobody has to remember
to run it.

## What Changes

- **New `set-copilot transcript` command** — post-processes raw transcript JSONL into a
  readable, AI-friendly Markdown transcript plus a sentence-level structured JSONL:
  `--input` (file, directory, or glob; defaults to the runtime dir's last archived
  transcript), `--out`, `--speakers mic=Gábor,system=Robi`, `--redact <json>`, `--stats`.
- **New `src/transcript-build.ts`** — the reconstruction engine, ported from the proven
  reference implementation in `consumer-c`: per-channel rebuild → sentence split →
  chronological merge on `startTs`, exact word-boundary decisions from `cont`/`midWord`
  with a dictionary heuristic fallback for pre-`a30d12f` recordings, capture-rotation
  timeline repair, overlap marking, and `reconnect` gap annotation. Pure logic, no audio
  — fully unit-testable.
- **Automatic generation at `stop`** — after archival, `handoverAtStop` also writes the
  `.md` and the stitched `.jsonl` next to the archive and reports all three paths.
  Config-gated (`transcript.stitchOnStop`, default **on**). The dictation (`--print` /
  `/dd`) path is **untouched**: there the raw text is the user's message, not a document.
- **Batch/backfill mode** — a directory or glob input processes many archived transcripts
  in one run, so the existing archive (258 files across 5 projects) becomes readable
  without a hand-written script per project.
- **New config section `transcript`** — `speakers` (channel → display name),
  `stitchOnStop`, and `completeWords` (the function-word list behind the heuristic
  fallback, defaults covering Hungarian + English). The word list is config, not a regex
  in `src/`, for the same reason `detect.urgency` is.
- **Library export** — `stitchTranscript()` from the package entry point, so a consumer
  can rebuild in-process rather than shelling out.

No breaking changes: the raw `.jsonl` keeps its exact shape and stays the archive of
record; the new artifacts sit alongside it.

## Capabilities

### New Capabilities
- `transcript-stitch`: reconstructing readable, sentence-level transcripts from the
  capture's fragmented JSONL — word-boundary resolution (exact from `cont`/`midWord`,
  heuristic for legacy recordings), per-channel rebuild and chronological merge on
  `startTs`, capture-rotation timeline repair, overlap and connection-loss annotation,
  the `set-copilot transcript` command surface, and batch/backfill over an archive.

### Modified Capabilities
- `meeting-transcript-persistence`: stop-time handover now produces the readable and
  structured artifacts alongside the archived raw transcript and reports all of their
  paths; the `meeting-copilot` stop summary points at the readable transcript as the
  canonical source for downstream knowledge processing.

## Impact

- **New code**: `src/transcript-build.ts`, `src/transcript-build.test.ts` (synthetic
  fixture only — no client transcript may enter the repo, per `docs/PRE-PUBLISH.md`).
- **Modified**: `src/cli.ts` (`case "transcript"`, `handoverAtStop`, help text),
  `src/config.ts` (`transcript` section + defaults), `src/index.ts` (export),
  `skills/meeting-copilot/SKILL.md` (stop flow points at the `.md`).
- **Unaffected**: the audio chain, Soniox clients, `transcript-writer.ts` (line shape
  unchanged), `poll.ts`, the runtime-dir handover invariants, and the `/ds` / `/dd`
  dictation flow.
- **Dependencies**: none added — the reference implementation is dependency-free.
- **Downstream**: the raw `.jsonl` remains the archive of record, so existing consumers
  keep working; the recommendation is that knowledge processing switch to the `.md`.
