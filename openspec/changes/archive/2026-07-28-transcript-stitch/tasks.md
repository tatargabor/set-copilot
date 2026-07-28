## 1. Config seam

- [x] 1.1 Add the `transcript` section to `CopilotConfig` in `src/config.ts`: `speakers`
      (`Record<string, string>`, default `{}`), `stitchOnStop` (boolean, default `true`),
      `completeWords` (`string[]`, defaults covering Hungarian + English function words —
      port the reference list, add the English equivalents), `pauseGapMs` (default 2500).
- [x] 1.2 Wire the section into the resolution chain (defaults → user config → project
      config → env), merging key by key like the other nested sections.
- [x] 1.3 Extend `src/config.test.ts`: defaults present, a project config overriding
      `completeWords` and `speakers` wins, nested merge does not drop sibling keys.

## 2. The stitch engine (`src/transcript-build.ts`)

- [x] 2.1 Define the types: `StitchLine` (a parsed raw line), `StitchedSentence`
      (`speaker`, `text`, `startTs`, `endTs`, `overlap?`, `exact`), `StitchOptions`
      (speakers, completeWords, pauseGapMs, redactions), `StitchResult` (markdown, jsonl,
      stats, sentences).
- [x] 2.2 `parseLines(text)` — tolerant JSONL parse: skip blank and malformed lines, skip
      events with no `text` (`silence`), keep `reconnect` events as timeline markers.
- [x] 2.3 `applyRotationOffset(rows)` — detect the backwards timestamp jump (> 60s), offset
      the later segment onto the real timeline (including `startTs`), return the break point.
- [x] 2.4 `separator(prevText, line, gapMs, stats, opts)` — exact from `cont`/`midWord`;
      otherwise the bounded heuristic (non-letter end, non-lowercase start, gap ≥
      `pauseGapMs`, or either adjoining word in `completeWords` → space). Unicode classes
      only (`\p{L}`, `\p{Ll}`, `\p{N}`) — no `\b`, no enumerated Latin ranges. Count exact
      vs. guessed.
- [x] 2.5 `rebuildChannel(rows, speaker, stats, opts)` — concatenate one channel's fragments
      through `separator`, recording `{pos, ts, endTs}` marks for timestamp lookup.
- [x] 2.6 `splitSentences(channel, speaker)` — split on `[.?!…]` followed by whitespace or
      end; take each sentence's start timestamp at its first non-whitespace character (the
      space after terminal punctuation still belongs to the previous fragment).
- [x] 2.7 `markOverlaps(sentences)` — mark sentences whose span intersects a sentence from
      the other channel within a bounded window.
- [x] 2.8 `stitchTranscript(rows, opts)` — orchestrate: rotation offset → per-channel rebuild
      and split → merge sorted by `startTs` (fallback `ts`), tie-broken by speaker →
      overlaps → render. Return `null` for an input with no usable lines.

## 3. Rendering

- [x] 3.1 `renderMarkdown(sentences, ctx)` — `**[hh:mm:ss] Név:**` turns, `⇄` for overlap,
      speaker names from `transcript.speakers` with fallback to the raw channel name.
- [x] 3.2 Render the rotation break as an explicit block note at its point in the stream.
- [x] 3.3 Render each `reconnect` event as a visible warning naming the gap ("words may be
      missing here"), so a hole is never read as continuous speech.
- [x] 3.4 Render redaction windows: sentences inside a window are omitted and replaced by a
      single marker naming the window and its reason.
- [x] 3.5 `renderJsonl(sentences)` — one sentence per line carrying `speaker`, `text`,
      `startTs`, `endTs`, `overlap`, `exact`.

## 4. Unit tests (`src/transcript-build.test.ts`)

- [x] 4.1 Write the synthetic fixture reproducing the failure shape: six `system` fragments
      with `mic` lines interleaved, including a `cont`+`midWord` join (`…a speci` +
      `fikációig`) and a `cont`-without-`midWord` join (`…Drive-on` + `több`). Synthetic
      only — no client transcript in the repo.
- [x] 4.2 The six fragments produce ONE sentence; `speci|fikációig` joins with no separator,
      `Drive-on|több` joins with a space.
- [x] 4.3 On the `cont`/`midWord`-carrying fixture, guessed boundaries = 0.
- [x] 4.4 Legacy fixture (no `cont`/`midWord`): the complete-word rule forces a space, a gap
      ≥ `pauseGapMs` forces a space, an uppercase/digit start forces a space, and only the
      remaining case glues; guessed count > 0.
- [x] 4.5 Two-channel ordering: a long utterance that starts before and finishes after
      several short opposite-channel lines sorts before them (`startTs`, not `ts`); a
      `startTs`-less input still stitches via the `ts` fallback.
- [x] 4.6 Rotation: after the backwards jump every sentence timestamp increases and the break
      is marked.
- [x] 4.7 Edge cases: empty input → `null` (no artifacts); truncated final line skipped;
      `silence` events produce no text; a `reconnect` event renders a warning.
- [x] 4.8 Mic-only input stitches with no overlap markers.
- [x] 4.9 Overlap marking and the configured speaker-name mapping (including the unmapped
      fallback).

## 5. CLI surface

- [x] 5.1 Add `case "transcript"` to `src/cli.ts` dispatch and a `cmdTranscript(args)`
      handler parsing `--input`, `--out`, `--speakers`, `--redact`, `--stats`.
- [x] 5.2 Input resolution: no `--input` → the runtime dir's last transcript via
      `lastTranscript()`; a `.jsonl` path → that file; a directory or glob → every matching
      transcript, each processed independently, a failure logged and skipped so a large
      backfill never aborts.
- [x] 5.3 Output resolution: no `--out` → beside the input, `.jsonl` → `.md` plus the
      `-stitched.jsonl` sidecar. Never write a zero-byte artifact.
- [x] 5.4 `--stats` to stderr: segments, sentences, exact vs. guessed boundaries (and how
      many were glued).
- [x] 5.5 `--speakers mic=X,system=Y` overrides `transcript.speakers`; `--redact <json>`
      loads the time-window list.
- [x] 5.6 Add the command to `printHelp()`.

## 6. Stop-time integration

- [x] 6.1 In `handoverAtStop` (`src/cli.ts`), after `handoverTranscriptOnce` returns a path
      and when `transcript.stitchOnStop` is on, stitch the ARCHIVED file and print all three
      paths (`Transcript saved:` / `Readable:` / `Structured:`).
- [x] 6.2 Wrap the derived step: a stitch failure is reported and the archived path is still
      returned; the rename stays the sole source of truth for the handover invariant.
- [x] 6.3 Leave the `--print` (dictation `/dd`) branch untouched — it returns before the
      stitch. Verify by running `/ds` + `/dd` end to end.
- [x] 6.4 Verify `stitchOnStop: false` restores exactly the pre-change stop output.

## 7. Exports, skill, docs

- [x] 7.1 Export `stitchTranscript` and its types from the package entry point.
- [x] 7.2 Update `skills/meeting-copilot/SKILL.md`'s stop flow: report the readable
      transcript as the source for note-taking / knowledge extraction and the raw JSONL as
      the archive of record.
- [x] 7.3 Update `CLAUDE.md`'s architecture section with `src/transcript-build.ts` and the
      `transcript` config seam.
- [x] 7.4 Mark `docs/handoff-transcript-stitch.md` as addressed, linking this change.

## 8. Verification

- [x] 8.1 `npm test` green, `npm run build` (tsc strict) clean.
- [x] 8.2 Run the acceptance criteria from `docs/handoff-transcript-stitch.md` §6 against the
      built CLI: criteria 1–5.
- [x] 8.3 Backfill smoke test: run the command over one project's archive directory outside
      this repo and confirm every file produced artifacts, with the `--stats` guessed counts
      recorded for the legacy files.
