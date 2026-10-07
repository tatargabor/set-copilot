# Proposal

## Why

In the 2026-10-07 meeting the spoken-command opener `copilot` fired three times inside longer
words: „Meeting Copilotot", „Copilotokat" and „Set Copilotos". One of the three closed and
reached the copilot as a real `command` event; the other two became `command-abandoned`
events. The transcript proves where it happened: each span's text begins with the suffix
(`"ot, alapból a…"`, `"okat meg az elmaradt…"`, `"os beállításokat…"`).

The matcher is whole-word on paper (`findWord` checks the character before and after the
hit), but it treats **the end of the buffer as a word boundary**. The fast lane reads the token
stream, and Soniox delivers a Hungarian suffixed word as two tokens (`" Copilot"`, `"ot"`):
after the first token the buffer ends in `copilot`, the "after" check sees end-of-buffer, and
the span opens before the suffix arrives. Hungarian attaches suffixes directly to the word, so
this is the normal case for the language the copilot is used in, not an edge case.

## What Changes

- An opening marker counts only when a non-letter, non-digit character has been **seen**
  after it in the stream: a space (the leading space of the next word's token), punctuation, or
  any other separator. A marker that ends the buffer so far is held until the next piece
  arrives; if that piece continues the word (`ot`, `okat`, `os`), no span opens.
- The pending buffer is trimmed on a word boundary, so a trimmed tail can never start in the
  middle of a word and present its last letters as a whole word.
- Closing markers are unchanged: a closing word takes effect when it is said (see design D2).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `fast-lane-commands`: "Markers match whole words, accent- and case-insensitively" gains the
  rule that an opener needs an observed boundary after it, with the three field phrases as
  scenarios.

## Impact

- `src/fast-lane.ts` (the matcher and the pending-buffer trim), `src/fast-lane.test.ts`.
- No config, CLI or wire-format change. Latency: an opener is confirmed one token later, which
  is the first word of the instruction — the span cannot carry anything before that anyway.
- Review: touches `src/`, so it goes through `/opsx:review`.
