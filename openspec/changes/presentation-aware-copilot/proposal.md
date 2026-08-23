## Why

The replay harness measured the gap and named it. Across three real-time runs of the
`reference` scenario, exactly one planted trap was missed **every time**: the presenter
says the ASP investment was *12 milliárd* while the source deck says *21,8 milliárd*, and
nobody in the room corrects it. Every other trap was caught at least once; this one is not
noise, it is a stable hole.

The reason is not judgement. The copilot cannot check a spoken claim against the deck
because **the deck is not in its knowledge**. `knowledge.sources` resolves `.md` only, so a
presentation — the single most common thing a meeting is *about* — is invisible to it.

This is also the most demonstrable capability the package has. Competing meeting AIs
summarize after the fact; none of them tells a presenter, mid-sentence, that they just
contradicted their own slide.

## What Changes

- **A deck is a knowledge source.** `knowledge.deck` accepts files or globs; each is
  extracted into ordered, titled **slides**. Markdown, plain text, and HTML are handled,
  including HTML whose body is wrapped in a static-export bundler template.
- **A slide keeps its identity.** Extraction preserves slide order and title, so an alert
  can cite *which slide* a fact came from. A citation of "the knowledge base" is not
  actionable in a live meeting; "slide 11 says 21,8 milliárd" is.
- **Numeric claims are extracted per slide.** The kind of contradiction a presenter
  actually makes is a number: a figure, a count, a duration, a ranking. These are pulled
  out as first-class facts so a spoken number can be checked against them, rather than
  left buried in prose the copilot has to re-read.
- **Slides feed the existing pipeline** — keyword patterns (so a transcript line is tagged
  with the slide it belongs to), enriched context, and the digest the skill loads at
  session start. No new consumer, no new prompt mechanism.
- **`set-copilot deck` prints what was extracted.** An operator must be able to see the
  slides and facts the copilot will use, for the same reason the scenario timeline exists:
  an unreviewed input silently becomes a wrong answer.
- **BREAKING**: nothing. A project with no `knowledge.deck` is unchanged.

## Capabilities

### New Capabilities
- `deck-knowledge`: a presentation as a knowledge source — slide extraction and identity,
  the numeric claims a slide asserts, and how both reach the copilot's context.

### Modified Capabilities
<!-- None. The knowledge adapter, the digest artifacts, and the alert taxonomy are all
     reached through their existing seams. -->

## Impact

- **New code**: `src/knowledge/deck.ts` (pure extraction: file → slides → facts), wired
  into `run-digest.ts` and the markdown adapter's keyword/context/digest outputs. A `deck`
  subcommand in the CLI.
- **`src/config.ts`**: a `knowledge.deck` section. `resolveSources`' `.md`-only default
  stays as it is for `knowledge.sources`; the deck brings its own extensions.
- **Verification is a closed loop**, and that is the point of having built the harness
  first: re-run `reference` and see whether `m-asp-osszeg` is caught. The baseline it is
  measured against already exists, with its noise band.
- **No change** to the skills, the wall, or the alert taxonomy.
