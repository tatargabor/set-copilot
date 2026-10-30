# Design

## D1 — An opener is confirmed by a boundary that was actually observed

`findWord` accepted `after === end-of-buffer` as a boundary. For text that is complete (a
written line) that is right; for a token stream it is a guess, and in Hungarian the guess is
usually wrong — the suffix arrives in the next token. The opener now requires a real separator
character after the marker in the folded buffer. `fold` collapses every non-letter/digit run
to one space, so "seen a space, a comma, a full stop, a dash" are all the same test.

How an intended opener is distinguished: **the word stands alone** — it is followed by
whitespace (Soniox gives every new word a leading space) or punctuation. A speaker who says
„Copilot, rajzold fel…" or „Copilot rajzold fel…" opens a command at the next token; a
speaker who says „Copilotot" never does. A pause alone is not needed and not used: the opener
has no effect until instruction words arrive, and the first of them carries the leading space
that confirms it.

The held marker costs nothing: it stays in the pending buffer, which is re-examined on every
piece. Nothing is emitted for an unconfirmed opener, so there is no "retract" path.

## D2 — Closers keep end-of-buffer as a boundary

A closing word is the moment the speaker hands the instruction over. Waiting for the token
after it would delay every command until the speaker says something else — or until the
3-second flush — and the fast lane exists to cut latency (~250 ms poll tick). The two risks are
not symmetric either: a false open turns ordinary talk into an instruction (the field failure);
a false close produces a short, visible command. So the boundary rule changes for openers only.
Reported as an adjacent finding: a closer such as `stop` can still fire inside `stoppolni` when
the stem arrives as its own token.

## D3 — The pending trim lands on a word boundary

`pending` keeps the last 200 characters. A slice that starts mid-word (`…autocopilot` →
`copilot…`) would present a word's tail as a whole word, with "start of buffer" counted as a
boundary. The trim now drops the partial leading word when the character before the cut is a
letter or digit. Same class of defect as D1 (a buffer edge treated as a word edge), so it is
fixed with it.

## Reproduction (regression-from-field)

Field input: `transcript-2026-10-07T16-52-53-662Z.jsonl` (a consumer project's meeting; the
phrases are quoted, not the file). Unit tests feed the three phrases as token sequences in the
shape Soniox delivered them (`" Meeting"`, `" Copilot"`, `"ot"`, `","`, …) and assert that no
span opens; they are run against the unfixed `fast-lane.ts` first and must fail there.

## D4 — Chunked backends emit a leading space (review F1)

The real-time client's tokens carry Soniox's leading space; the chunk client (`sonioxMode:
"chunk"`) and local whisper emitted `text.trim()`. Under D1 a chunk ending in `…Copilot` followed
by `rajzold fel csináld` would read as `copilotrajzold` and never open — a regression for those
backends. They now emit `" " + text.trim()` (`chunkEventText`). The same missing space made the
writer mark every chunk resumption `midWord`, so the stitch glued two words at each chunk join;
that sibling defect is fixed by the same line.

## D5 — Stated limits (review F2, F3)

- `fold` turns `'` and `-` into separators, so `Copilot's` and `Copilot-ot` still confirm an
  opener. Hungarian suffixes attach without a hyphen except after abbreviations and numerals, and
  Soniox wrote all three field cases without one; narrowing "separator" to whitespace and clause
  punctuation is left for a measured case.
- The extracted instruction keeps the speaker's own text between the markers, trimmed of
  whitespace only, so an opener followed by a comma yields `, rajzold`. That is today's behaviour
  (`sliceAtMarker`), unchanged here; the scenario says "carrying `rajzold`" accordingly.
