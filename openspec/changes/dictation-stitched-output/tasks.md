## 1. The plain renderer

- [x] 1.1 `renderPlain(sentences)` in `src/transcript-build.ts` — sentences joined with a single
      space, no timestamps, no speaker labels, no markdown. A renderer over the SAME sentence
      stream as `renderMarkdown`, never a second reassembly path.
      Takes the `StreamItem[]` stream like its two siblings rather than a bare sentence list, so
      all three renderers have one signature shape and one input. Non-sentence items (rotation,
      reconnect) produce nothing — they are facts about the recording, not something the speaker
      said — and a redacted window is skipped without a marker, because a `⏹ cut` line in the
      middle of an instruction is contamination and the dictation path passes no redactions.
- [x] 1.2 Expose it from `stitchTranscript`'s result (e.g. a `plain` field) so a caller does not
      have to re-walk the sentences.
- [x] 1.3 Export `renderPlain` from `src/index.ts`.

## 2. Wire it into the dictation print path

- [x] 2.1 `printTranscriptOnce` (`src/handover.ts`) stitches the live transcript and writes the
      plain text to stdout instead of the raw body.
- [x] 2.2 Archival is untouched: the same delegation to `handoverTranscriptOnce`, the same single
      `renameSync`, still after the print. Verify the double-`/dd` invariant by test.
- [x] 2.3 Fail open: on a throw, or on a null stitch result from a NON-empty transcript, print the
      raw contents (today's behavior) and log a diagnostic to stderr.
      **Sharpened during apply.** "Non-empty" was too weak a test: `parseLines` rejects a line it
      cannot read, so a malformed-but-non-empty transcript would have produced no text and printed
      *nothing* — swallowing exactly what the fail-open rule exists to protect. The condition is
      now "unless every line is a recognisable non-speech event": a silence-only transcript
      legitimately prints nothing, and anything the parser could not make sense of falls back to
      raw. The stitch options are optional-chained off `cfg.transcript` for the same reason —
      `printTranscriptOnce` is exported, and a hand-built config should get the stitch's defaults,
      not the raw fallback via a thrown `TypeError`.
- [x] 2.4 An empty/absent transcript stays a no-op returning `null` — unchanged.
- [x] 2.5 No derived artifacts are written on this path (no `.md`, no `-stitched.jsonl`).

## 3. Tests

- [x] 3.1 A `cont` line without `midWord` is joined with a space; with `midWord`, with no
      separator — asserted through the print path, not just the engine.
- [x] 3.2 The printed output contains no timestamps, no speaker labels, and no JSON.
- [x] 3.3 Silence events produce no text.
      Two tests: a silence-only transcript prints nothing at all (and still archives), and a
      silence *between* two sentences disappears without disturbing them.
- [x] 3.4 Empty transcript → nothing printed, `null` returned, nothing archived.
- [x] 3.5 Exactly-once still holds: the transcript is archived, and a second call prints nothing.
- [x] 3.6 Fail-open: with a stitch that throws, the raw contents are printed, the archive still
      happens, and a diagnostic reaches stderr.
      In its own file (`handover.failopen.test.ts`) because the mock has to replace
      `transcript-build` for the whole module graph, and the other tests deliberately exercise the
      real stitch. A second, unmocked test covers the other fail-open trigger (a transcript the
      parser cannot read).
- [x] 3.7 Regression fixture built from the real failure shape (synthetic, per
      `docs/PRE-PUBLISH.md`): `"…a SetPromo-ból a ide, a"` + `[cont] "meetingek át lettek szedve?"`
      → one clean sentence, never `ameetingek`.

The pre-existing dictation test fixture (`{"text":"typed by voice"}`) had neither `speaker` nor
`ts`, so it was never a transcript line the parser accepts — it passed only because the old code
printed the file verbatim. Replaced with real lines.

## 4. The skills

- [x] 4.1 `skills/dd/SKILL.md`: DELETE the "Parse the JSONL lines / concatenate the `text` fields"
      instruction. Replace with: the command's output is the user's message — act on it.
- [x] 4.2 `skills/dictate/SKILL.md`: same deletion in the `stop` section, including the sample
      JSON line and the "skip silence lines / ignore topics" mechanics that no longer apply.
- [x] 4.3 Keep the empty case verbatim: "Dictation stopped, no text captured."
- [x] 4.4 Keep every existing rule that still holds: do not echo it back, do not cross-reference a
      knowledge base, answer in the language dictated.
- [x] 4.5 Check `skills/ds/SKILL.md` needs no change (it only starts a capture — confirm, do not
      assume). Read in full: it starts a capture and parses nothing. No change.

## 5. Docs

- [x] 5.1 `CLAUDE.md`: correct the standing statement that the `--print` path is untouched by the
      stitch — it now emits stitched plain text while still producing no artifacts. State WHY the
      distinction (text vs. artifacts) is the meaningful one.
- [x] 5.2 Note the fail-open posture next to the wall's fail-closed one, so the asymmetry reads as
      deliberate rather than inconsistent. Also noted that `printTranscriptOnce` is exported, so
      its output shape is public.

## 6. Verification

- [x] 6.1 `npm test` green (480 tests, 30 files), `npm run build` (tsc strict) clean.
- [x] 6.2 End-to-end on a scratch runtime dir: a dictation fixture with a `cont` join → `stop
      --print` emits one clean sentence, archives once, and a second `stop --print` prints nothing.
      Output was `Az lenne a kérdésem, hogy a SetPromo-ból a ide, a meetingek át lettek szedve? És
      ha igen, akkor mikor.` — the mid-word cut healed, the silence event gone, one archive file in
      the dir and no derived artifacts.
- [ ] 6.3 Live check: `/ds` → dictate a sentence with a deliberate pause mid-word → `/dd` and
      confirm the text arrives intact.
      **NOT RUN — it needs someone speaking into a microphone, which this session cannot do.** It
      is the one task left open in this change.
      Covered as far as it can be without a live mic, and with real rather than synthetic data:
      the new renderer was run over **15 real archived dictations** from the operator's own
      `set-promo` sessions (268 lines, 6 `cont`, 3 `midWord`). All three mid-word boundaries heal
      correctly — `"…incsenek speci" + "fikálva…"` → `specifikálva`, `"…ően a mi ökosz" +
      "isztémánkból…"` → `ökoszisztémánkból`. On the same files the naive space-join would have
      split those 3 words and the naive no-separator join would have glued 3 other word pairs; the
      stitch output differs from **both** naive readings on 8 of the 15 files. What remains
      unexercised is the audio chain itself, which wants one live `/ds` → `/dd`.
- [x] 6.4 Confirm the meeting `stop` output is byte-identical to before this change.
      Ran the same input through the pre-change build (`git stash`) and the post-change one:
      stdout identical after normalising the archive timestamp, and the `.md` and
      `-stitched.jsonl` artifacts byte-identical.
