## Purpose

A presentation as a knowledge source: the slides a deck contains, the claims each slide
asserts, and how both reach the copilot so a spoken sentence can be checked against the
slide behind it.

## IN SCOPE

- Turning a deck file into ordered, titled slides.
- The claims a slide asserts, in a form a spoken sentence can be compared against.
- How slides reach the existing knowledge pipeline.
- Making the extraction inspectable before it is relied on.

## OUT OF SCOPE

- Rendering, screenshotting, or displaying a deck. This is knowledge, not a viewer.
- Knowing which slide is currently on screen. The copilot infers from what is said; it has
  no view of the presenter's screen, and pretending otherwise would be a false claim.
- Judging whether a claim is *true*. The deck is the reference, not an oracle: a
  contradiction against it means the speaker and the slide disagree, and either may be wrong.

## ADDED Requirements

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
