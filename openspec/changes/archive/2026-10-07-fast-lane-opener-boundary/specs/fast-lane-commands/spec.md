# Spec Delta

## IN SCOPE

- An opening marker requires an observed non-letter, non-digit character after it in the
  stream; a marker at the end of the stream so far is held, not matched.
- The pending buffer is trimmed on a word boundary.
- Regression scenarios built from the three 2026-10-07 field phrases.
- The chunked backends (Soniox chunk mode, local whisper) deliver each chunk with a leading space,
  so a chunk boundary is an observed word boundary.

## OUT OF SCOPE

- Closing markers: they keep end-of-stream as a boundary (design D2); the `stop` / `stoppolni`
  risk is reported, not changed.
- The shipped default vocabulary (`copilot`, `start`, `csináld`, `stop`) and `copilot.names`.
- `detect.command` / the line-level `command: true` flag.
- An apostrophe or hyphen after an opener (`Copilot's`, `Copilot-ot`) still counts as a boundary
  (design D5).
- Stripping leading punctuation from the extracted instruction (design D5).

## MODIFIED Requirements

### Requirement: Markers match whole words, accent- and case-insensitively

Markers SHALL be matched against speech folded to lowercase with combining accents removed and
every run of non-letter, non-digit characters (over Unicode letters and digits) treated as one
separator. A marker SHALL match only as a whole word: it SHALL NOT match inside a longer word.

Because speech arrives as tokens and a suffixed word can arrive split across them (Hungarian
attaches suffixes directly to the word: `Copilot` + `ot`), an **opening** marker SHALL count
only once a separator character has been observed after it in the stream. An opening marker
that ends the speech received so far SHALL NOT open a command until the next piece of speech
arrives; if that piece continues the word, no command SHALL open. A closing marker SHALL take
effect as soon as it is received, including at the end of the speech received so far. The
buffer the engine keeps while no command is open SHALL be trimmed so that it never begins in
the middle of a word.

#### Scenario: Accent and case variants are one marker

- **WHEN** the end word is configured as `csináld` and the speaker's text contains `CSINALD`
- **THEN** it closes the command, while the extracted instruction keeps the speaker's own
  accented text

#### Scenario: A marker inside a longer word is ignored

- **WHEN** the start word is `start` and the speaker says `we restart the server`
- **THEN** no command is opened

#### Scenario: A suffixed opener split across tokens does not open a command

- **WHEN** the start word is `copilot` and the speech arrives as the tokens of
  „Meeting Copilotot", „Copilotokat" or „Set Copilotos", with the suffix in its own token
  after `Copilot`
- **THEN** no command is opened and no `command-abandoned` event is produced for any of them

#### Scenario: A standalone opener is confirmed by the next word

- **WHEN** the start word is `copilot` and the tokens `" Copilot"`, `" rajzold"`, `" fel"`,
  `" csináld"` arrive one at a time
- **THEN** one command with the text `rajzold fel` is produced

#### Scenario: An opener followed by punctuation is confirmed

- **WHEN** the start word is `copilot` and the tokens `" Copilot"`, `","`, `" rajzold"`,
  `" csináld"` arrive one at a time
- **THEN** one command carrying `rajzold` is produced

#### Scenario: A closer at the end of the received speech closes at once

- **WHEN** a command is open and the last token received is the end word `csináld`, with nothing
  after it
- **THEN** the command is produced on that token, without waiting for further speech

#### Scenario: A trimmed buffer never starts mid-word

- **WHEN** no command is open and the buffered speech is trimmed at a point inside a word ending
  in the start word (for example `…autocopilot`)
- **THEN** the trimmed tail does not present that word's ending as a standalone start word, and
  no command is opened from it

#### Scenario: A chunk boundary confirms an opener

- **WHEN** a chunked backend delivers `Na jó, Copilot` and then `rajzold fel csináld` as two chunks
- **THEN** one command carrying `rajzold fel` is produced
