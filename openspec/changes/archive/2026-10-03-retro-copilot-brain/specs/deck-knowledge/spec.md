## ADDED Requirements

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
