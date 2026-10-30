# deck-knowledge Specification

## Purpose
A presentation as a knowledge source: the slides a deck contains, the claims each slide
asserts, and how both reach the copilot so a spoken sentence can be checked against the
slide behind it.

## Requirements

### Requirement: A deck is extracted into ordered, titled slides

The system SHALL turn each configured deck file into one or more slides, each carrying its
position in the deck, a title, and its text. Order SHALL follow the deck's own order, so a
reference to a slide is stable across runs.

#### Scenario: A deck file becomes slides

- **WHEN** a deck file is configured and extracted
- **THEN** its slides are produced in deck order, each with a position, a title, and its text

#### Scenario: A slide with no title of its own still gets one

- **WHEN** a slide's source carries no usable heading
- **THEN** it is titled from its file or position rather than left unnamed, so it can still
  be cited

#### Scenario: An unreadable deck file is reported, not fatal

- **WHEN** one configured deck file cannot be read or yields no text
- **THEN** it is reported with the reason and skipped, and the remaining files still extract

### Requirement: Common presentation formats are handled, including wrapped exports

Extraction SHALL handle markdown, plain text, and HTML. Where an HTML file's real content
is wrapped by a static-export tool rather than present in the document body, the wrapper
SHALL be unwrapped before extraction.

This is a *format* concern and belongs to the engine; which decks a project uses is
configuration. A deck that extracts to nothing is worse than an error, because it looks
like a copilot that simply failed to notice.

#### Scenario: A markdown deck splits on its headings

- **WHEN** a markdown deck is extracted
- **THEN** its headings delimit slides, and each heading becomes its slide's title

#### Scenario: An HTML slide yields its visible text

- **WHEN** an HTML slide is extracted
- **THEN** its visible text is produced without markup, scripts, styles, or embedded data URIs

#### Scenario: A bundler-wrapped HTML export is unwrapped first

- **WHEN** an HTML file carries its real document inside a static-export wrapper
- **THEN** the wrapped document is unwrapped and extracted, rather than yielding the
  wrapper's own loading text

#### Scenario: A deck that extracts to nothing says so

- **WHEN** extraction of a configured deck produces no slides
- **THEN** a warning names the deck and the reason, rather than proceeding silently with an
  empty knowledge base

### Requirement: A slide's numeric claims are extracted as facts

For each slide the system SHALL extract the numeric claims it asserts — the figure, the
unit or scale where present, and the surrounding words that give it meaning — as
first-class facts attached to that slide.

A presenter's contradiction against their own deck is overwhelmingly a *number*: an amount,
a count, a duration, a ranking. Leaving those buried in prose asks the copilot to re-read a
whole deck mid-sentence; naming them makes the comparison cheap enough to happen live.

#### Scenario: A figure with a scale word is captured with it

- **WHEN** a slide asserts an amount with a scale or unit
- **THEN** the fact carries the figure, the scale or unit, and enough surrounding words to
  identify what it refers to

#### Scenario: A slide's facts name their slide

- **WHEN** a fact is extracted
- **THEN** it carries the position and title of the slide it came from, so an alert can cite it

#### Scenario: A slide with no numbers yields no facts, and that is not an error

- **WHEN** a slide asserts no numeric claim
- **THEN** it produces no facts and is still available as a slide

### Requirement: Slides reach the copilot through the existing knowledge pipeline

Extracted slides and their facts SHALL be delivered through the knowledge artifacts the
copilot already loads — the keyword index, the structured context, and the session digest.
No new consumer, artifact, or prompt mechanism is introduced.

#### Scenario: A transcript line is tagged with the slide it belongs to

- **WHEN** speech matches the distinctive terms of a slide
- **THEN** the transcript line carries that slide as a topic, through the existing keyword index

#### Scenario: The digest carries the slides and their facts

- **WHEN** the knowledge digest is built with a deck configured
- **THEN** the digest presents the deck's slides in order with their numeric facts, so a
  session that loads the digest can cite a slide without re-reading the deck

#### Scenario: A project with no deck is unchanged

- **WHEN** no deck is configured
- **THEN** every knowledge artifact is byte-identical to what it was before

### Requirement: The extraction is inspectable before it is relied on

The system SHALL provide a way to print the slides and facts a configured deck yields, so
an operator can check them before a live meeting depends on them.

An extraction nobody has looked at fails in the worst direction: the copilot stays silent
and the silence is indistinguishable from a meeting where nothing was worth saying.

#### Scenario: An operator can read the extracted slides

- **WHEN** an operator asks to see the configured deck
- **THEN** the slides are printed in order with their titles and their extracted facts

#### Scenario: The report names what failed to extract

- **WHEN** a configured deck file yielded nothing
- **THEN** the report names that file and the reason, rather than omitting it

### Requirement: A slide's keyword tags are its distinctive title words

Each slide SHALL contribute one keyword-index topic labelled `dia <position>: <title>`, whose stems
are words of the slide's title, split on anything that is not a Unicode letter or digit,
lower-cased and deduplicated. A word SHALL qualify when it has at least five characters, or when it
has at least three characters and the title wrote it with capitals — an upper-case letter after its
first character (`GaaP`) or entirely upper case (`ASP`, `KPI`). A stem that appears in the titles of
at least `max(2, ceil(30% of the slide count))` slides SHALL be dropped from every slide. A slide
left with no stems SHALL contribute no topic.

Stems come from the title because those are the words a presenter says when they arrive at a slide.
Short lowercase words (`a`, `és`) would tag every line with every slide, which is the same as
tagging nothing. A flat five-character floor, though, dropped every acronym — exactly the terms that
get spoken — so short words survive when capitalised, and the frequency filter is what makes that
lower bar safe: measured on a real deck, export-stamped titles put `quick`, `profile` and `deck` on
half the slides, and one spoken sentence matched six slides at once.

#### Scenario: Short lowercase words are dropped

- **WHEN** a slide is titled `Az ASP és a GaaP réteg`
- **THEN** its stems include `asp`, `gaap` and `réteg`, and not `az`, `és` or `a`

#### Scenario: A stem shared by many slides is dropped

- **WHEN** a four-slide deck is titled `quick win alkalmazott profile`, `quick win ASP profile`,
  `quick win mérés profile` and `nyílt forráskód`
- **THEN** slide 2's stems are exactly `["asp"]` and slide 4's are `["nyílt", "forráskód"]`

#### Scenario: A slide with nothing distinctive gets no topic

- **WHEN** a three-slide deck is titled `közös közös`, `közös közös` and `egyedi téma`
- **THEN** the index holds only the topic `dia 3: egyedi téma`

### Requirement: An export's build identifier is not taken as a slide title

For an HTML slide, the document `<title>` SHALL be used as the slide title unless it looks like a
build identifier — it contains a `/` or has no whitespace — in which case the first `<h1>`–`<h3>`
heading's text SHALL be used instead; the identifier SHALL remain the title only when the document
has no such heading. The document `<title>` and `<head>` SHALL NOT be part of the slide's extracted
text.

An export tool stamps titles like `07-quick-win-… — deck-export/profile`. Taken as the slide's
name, its words become keyword stems that match half the deck. Left in the slide text, an exported
title such as `11 — ASP …` made every slide's first extracted fact its own slide number.

#### Scenario: A real heading beats a build identifier

- **WHEN** an HTML slide has `<title>11-quick-win-asp — deck-export/profile</title>` and
  `<h1>Nem elhibázott beruházás</h1>`
- **THEN** the slide is titled `Nem elhibázott beruházás`

#### Scenario: A human title is kept even when a heading exists

- **WHEN** an HTML slide has `<title>04 — A vállalás megvan</title>` and `<h1>Más</h1>`
- **THEN** the slide is titled `04 — A vállalás megvan`

#### Scenario: The identifier is the last resort

- **WHEN** an HTML slide has `<title>11-asp — x/deck-profile</title>` and no `<h1>`–`<h3>`
- **THEN** the slide is titled `11-asp — x/deck-profile`

#### Scenario: The document title is not slide text

- **WHEN** an HTML slide with `<title>11 — ASP</title>` and a body that states no number is extracted
- **THEN** the slide's text does not contain the `<title>` content and the slide yields no facts

### Requirement: Deck awareness does not depend on the knowledge adapter

The deck SHALL be contributed by the digest pipeline after the configured adapter has run, whatever
that adapter is: slide topics SHALL be appended to the adapter's keyword patterns, the slides SHALL
be set as the structured context's `deck`, and the deck section SHALL be appended to the adapter's
digest. Deck files SHALL be resolved from `knowledge.deck` across the `.md`, `.txt`, `.html` and
`.htm` extensions. The digest summary line SHALL report the slide and fact counts, `deck configured
but EMPTY` when a deck is configured but yields no slides, and the number of deck files that failed
to extract.

A deck is orthogonal to however a project models the rest of its knowledge; a project running a
custom adapter must get deck awareness without implementing it.

#### Scenario: A custom adapter still gets the deck

- **WHEN** `knowledge.adapter` names a custom module and `knowledge.deck` names a two-slide deck
- **THEN** the keyword index holds the adapter's patterns followed by the slide topics, and the
  digest ends with the deck section

#### Scenario: An empty configured deck is reported in the summary

- **WHEN** `knowledge.deck` is configured but matches no extractable slide
- **THEN** the digest summary line ends with `deck configured but EMPTY`
