## Why

The operator's single most-wanted feature is the Claude Code session itself rendered into a
wall text box — *"a Claude Code-ba futó sessionnek a falon lévő szövegboxba való
megjelenítése nekem az nagyon hiányzik… méghozzá ugyanazzal a formázással"*
(`docs/wall-field-backlog.md` §B1). The transport for that already exists (the
`wall-mirror` Stop hook). What blocks it is that the wall cannot *show* a Claude Code
message, and the mirror path actively destroys the parts that carry the meaning:

- A wall text line has **no inner formatting at all**: `wall.js:349` sets the body with
  `textContent`, so only `white-space: pre-wrap` (`wall.css:87`) survives. A markdown table
  arrives as run-on text; a list arrives as one undifferentiated line per row — the
  operator's *"a markdownból a karakterre rajzolt táblázatot nem tudtuk megjeleníteni"*
  and *"tipikusan nincsen belső formázása egy szövegsornak"* (§A7, §B1).
- The hook **strips every fenced code block** (`hooks/wall-mirror.sh:48-51`) and truncates
  at 600 characters. For a coding copilot that is most of the message.
- The filler filter is a bare 40-character length floor hardcoded in the shell
  (`hooks/wall-mirror.sh:57`). It is a judgement about what is worth showing — exactly the
  kind of thing the project keeps in config, and the config seam (`copilot.mirror`,
  `src/config.ts:121-131`) already exists but carries only `enabled` + `category`. The
  operator's ask is a *policy*, not a longer threshold: *"a fölösleges folyamatos
  visszajelző, várakozó szövegsorok — ez a 'folyamatban', 'várok', 'csendben hallgatok' —
  ezek nélkül."*

Compactness is the third leg and follows from the first: the wall is read at a distance on
a 1920px screen (§A5), so a table has to stay a table instead of expanding into one bullet
per row.

## What Changes

- **A closed inline-formatting vocabulary for the `text` render.** Bold, italic, inline
  code, fenced code block, bullet and numbered list, and table — nothing else. Like
  `RenderType`, the vocabulary is closed: extending it is an engine change, never a config
  one. Formatting is built with DOM element construction only; the existing
  no-`innerHTML`-for-content property is preserved as a hard invariant, not as a
  consequence of using `textContent`.
- **A text line MAY carry structure without becoming a new payload type.** The `text`
  payload stays a string; formatting is a rendering concern derived from the string, so
  every existing producer, the redaction funnel, and the accumulated-state replay are
  unaffected.
- **Mirror content policy moves into `copilot.mirror` config** — the filler rules (a length
  floor *and* a phrase list), the length cap, and whether fenced code blocks are kept,
  stripped, or collapsed to a marker. Defaults preserve today's behavior except that code
  blocks are kept, because keeping them is the point of the feature.
- **The hook reads that policy instead of hardcoding it.** The shell script stops being the
  place where judgement lives.
- Non-goals: no new `RenderType`, no HTML or arbitrary markdown, no styling config, no
  change to the transport, the zone model, redaction, or the Stop-hook mechanism.

## Capabilities

### New Capabilities
- `text-formatting`: the closed inline vocabulary a `text` line may render, the safety
  invariant that governs how it is built, and the rule that the payload stays a plain
  string.

### Modified Capabilities
- `chat-mirror`: what counts as substantive becomes a config-expressed policy (filler
  phrases and floor, length cap, code-block handling) rather than a hardcoded threshold in
  the hook, and mirrored content retains the formatting that carries its meaning.

## Impact

- `src/wall/public/wall.js` — the text line builder (`:347-349`) gains the formatting pass.
- `src/wall/public/wall.css` — styles for the new inline elements, sized for a 1920px wall.
- `src/config.ts` — `MirrorConfig` gains the policy fields with defaults; `copilot-prompt.ts`
  is checked for whether the policy needs to reach the producer (it does not — the hook
  applies it).
- `hooks/wall-mirror.sh` — reads the resolved policy from the CLI instead of hardcoding the
  40-char floor and the unconditional code-block strip.
- `src/cli.ts` — a way for the shell hook to obtain the resolved mirror policy.
- Tests: the formatting parser is pure and unit-tested (input string → structured tokens);
  the DOM construction and the hook are verified by running the wall.
