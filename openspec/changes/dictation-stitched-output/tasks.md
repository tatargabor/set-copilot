## 1. The plain renderer

- [ ] 1.1 `renderPlain(sentences)` in `src/transcript-build.ts` — sentences joined with a single
      space, no timestamps, no speaker labels, no markdown. A renderer over the SAME sentence
      stream as `renderMarkdown`, never a second reassembly path.
- [ ] 1.2 Expose it from `stitchTranscript`'s result (e.g. a `plain` field) so a caller does not
      have to re-walk the sentences.
- [ ] 1.3 Export `renderPlain` from `src/index.ts`.

## 2. Wire it into the dictation print path

- [ ] 2.1 `printTranscriptOnce` (`src/handover.ts`) stitches the live transcript and writes the
      plain text to stdout instead of the raw body.
- [ ] 2.2 Archival is untouched: the same delegation to `handoverTranscriptOnce`, the same single
      `renameSync`, still after the print. Verify the double-`/dd` invariant by test.
- [ ] 2.3 Fail open: on a throw, or on a null stitch result from a NON-empty transcript, print the
      raw contents (today's behavior) and log a diagnostic to stderr.
- [ ] 2.4 An empty/absent transcript stays a no-op returning `null` — unchanged.
- [ ] 2.5 No derived artifacts are written on this path (no `.md`, no `-stitched.jsonl`).

## 3. Tests

- [ ] 3.1 A `cont` line without `midWord` is joined with a space; with `midWord`, with no
      separator — asserted through the print path, not just the engine.
- [ ] 3.2 The printed output contains no timestamps, no speaker labels, and no JSON.
- [ ] 3.3 Silence events produce no text.
- [ ] 3.4 Empty transcript → nothing printed, `null` returned, nothing archived.
- [ ] 3.5 Exactly-once still holds: the transcript is archived, and a second call prints nothing.
- [ ] 3.6 Fail-open: with a stitch that throws, the raw contents are printed, the archive still
      happens, and a diagnostic reaches stderr.
- [ ] 3.7 Regression fixture built from the real failure shape (synthetic, per
      `docs/PRE-PUBLISH.md`): `"…a SetPromo-ból a ide, a"` + `[cont] "meetingek át lettek szedve?"`
      → one clean sentence, never `ameetingek`.

## 4. The skills

- [ ] 4.1 `skills/dd/SKILL.md`: DELETE the "Parse the JSONL lines / concatenate the `text` fields"
      instruction. Replace with: the command's output is the user's message — act on it.
- [ ] 4.2 `skills/dictate/SKILL.md`: same deletion in the `stop` section, including the sample
      JSON line and the "skip silence lines / ignore topics" mechanics that no longer apply.
- [ ] 4.3 Keep the empty case verbatim: "Dictation stopped, no text captured."
- [ ] 4.4 Keep every existing rule that still holds: do not echo it back, do not cross-reference a
      knowledge base, answer in the language dictated.
- [ ] 4.5 Check `skills/ds/SKILL.md` needs no change (it only starts a capture — confirm, do not
      assume).

## 5. Docs

- [ ] 5.1 `CLAUDE.md`: correct the standing statement that the `--print` path is untouched by the
      stitch — it now emits stitched plain text while still producing no artifacts. State WHY the
      distinction (text vs. artifacts) is the meaningful one.
- [ ] 5.2 Note the fail-open posture next to the wall's fail-closed one, so the asymmetry reads as
      deliberate rather than inconsistent.

## 6. Verification

- [ ] 6.1 `npm test` green, `npm run build` (tsc strict) clean.
- [ ] 6.2 End-to-end on a scratch runtime dir: a dictation fixture with a `cont` join → `stop
      --print` emits one clean sentence, archives once, and a second `stop --print` prints nothing.
- [ ] 6.3 Live check: `/ds` → dictate a sentence with a deliberate pause mid-word → `/dd` and
      confirm the text arrives intact.
- [ ] 6.4 Confirm the meeting `stop` output is byte-identical to before this change.
