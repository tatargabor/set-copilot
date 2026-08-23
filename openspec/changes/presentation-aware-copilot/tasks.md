## 1. Extraction (pure, testable first)

- [ ] 1.1 Define the slide and fact shapes: a slide carries deck position, title, and text; a fact carries figure, scale/unit, context words, and the slide it came from. [REQ: A deck is extracted into ordered, titled slides]
- [ ] 1.2 Implement markdown and plain-text extraction, splitting on headings, titling each slide from its heading and falling back to the file or position. [REQ: Common presentation formats are handled, including wrapped exports]
- [ ] 1.3 Implement HTML extraction: strip scripts, styles, markup and embedded data URIs; take the title from the document title or first heading. [REQ: Common presentation formats are handled, including wrapped exports]
- [ ] 1.4 Unwrap a static-export bundler template before extracting, so a wrapped deck yields its real content rather than the wrapper's loading text. [REQ: Common presentation formats are handled, including wrapped exports]
- [ ] 1.5 Order slides by configured file order plus any leading number in the filename. [REQ: A deck is extracted into ordered, titled slides]
- [ ] 1.6 Report an unreadable or empty deck file with its reason and continue with the rest. [REQ: A deck is extracted into ordered, titled slides] [REQ: Common presentation formats are handled, including wrapped exports]
- [ ] 1.7 Implement numeric-fact extraction: figure with locale-plural decimal separators, scale word or unit, a window of surrounding words, capped per slide. [REQ: A slide's numeric claims are extracted as facts]
- [ ] 1.8 Unit-test extraction and facts, including the wrapped-export case, a title-less slide, an empty deck, and a slide with no numbers. [REQ: A deck is extracted into ordered, titled slides] [REQ: A slide's numeric claims are extracted as facts]

## 2. Config seam

- [ ] 2.1 Add `knowledge.deck` (files or globs, with the deck's own extensions) to config, defaulting to empty. [REQ: Slides reach the copilot through the existing knowledge pipeline]
- [ ] 2.2 Unit-test that an absent or malformed key is dropped with a warning rather than killing the digest, following the `detect.*` posture. [REQ: Slides reach the copilot through the existing knowledge pipeline]

## 3. Pipeline wiring

- [ ] 3.1 Contribute slide-derived keyword patterns so a transcript line is tagged with its slide through the existing keyword index. [REQ: Slides reach the copilot through the existing knowledge pipeline]
- [ ] 3.2 Contribute slides and facts to the structured context. [REQ: Slides reach the copilot through the existing knowledge pipeline]
- [ ] 3.3 Render the deck into the session digest: slides in order, each with its facts, sized so the digest stays loadable. [REQ: Slides reach the copilot through the existing knowledge pipeline]
- [ ] 3.4 Verify that with no deck configured every artifact is byte-identical to before. [REQ: Slides reach the copilot through the existing knowledge pipeline]

## 4. Inspection

- [ ] 4.1 Implement `set-copilot deck`: slides in order with titles and facts, and a named report of anything that failed to extract. [REQ: The extraction is inspectable before it is relied on]
- [ ] 4.2 Run it against the reference deck and read the output — the extraction has to be checked by a person before a measurement depends on it. [REQ: The extraction is inspectable before it is relied on]

## 5. Close the loop

- [ ] 5.1 Configure the reference deck and rebuild the knowledge artifacts. [REQ: Slides reach the copilot through the existing knowledge pipeline]
- [ ] 5.2 Re-run the `reference` scenario in real time with the deck configured, and score it. [REQ: A slide's numeric claims are extracted as facts]
- [ ] 5.3 Compare against the three-run baseline WITH the scenario's noise band. Report honestly whether `m-asp-osszeg` was caught and whether coverage moved beyond the band — a single run inside the band is not evidence. [REQ: A slide's numeric claims are extracted as facts]
- [ ] 5.4 Check precision against its band too: a copilot that now cites slides for things nobody contradicted is a regression, and this is where it would show. [REQ: Slides reach the copilot through the existing knowledge pipeline]

## 6. Documentation

- [ ] 6.1 Document `knowledge.deck` and `set-copilot deck`, including what the copilot does NOT know (it cannot see the screen; it infers the slide from speech). [REQ: The extraction is inspectable before it is relied on]

## Acceptance Criteria (from spec scenarios)

- [ ] AC-1: A configured deck file yields slides in deck order, each with a position, title, and text. [REQ: A deck is extracted into ordered, titled slides, scenario: A deck file becomes slides]
- [ ] AC-2: A slide whose source carries no heading is still titled and citable. [REQ: A deck is extracted into ordered, titled slides, scenario: A slide with no title of its own still gets one]
- [ ] AC-3: An unreadable deck file is reported with its reason and the rest still extract. [REQ: A deck is extracted into ordered, titled slides, scenario: An unreadable deck file is reported, not fatal]
- [ ] AC-4: An HTML slide yields visible text without markup, scripts, or data URIs. [REQ: Common presentation formats are handled, including wrapped exports, scenario: An HTML slide yields its visible text]
- [ ] AC-5: A bundler-wrapped HTML export yields its real content, not the wrapper's loading text. [REQ: Common presentation formats are handled, including wrapped exports, scenario: A bundler-wrapped HTML export is unwrapped first]
- [ ] AC-6: A deck that extracts to nothing produces a warning naming it and the reason. [REQ: Common presentation formats are handled, including wrapped exports, scenario: A deck that extracts to nothing says so]
- [ ] AC-7: A numeric claim is captured with its scale or unit and enough context to identify it. [REQ: A slide's numeric claims are extracted as facts, scenario: A figure with a scale word is captured with it]
- [ ] AC-8: Every fact names the slide it came from. [REQ: A slide's numeric claims are extracted as facts, scenario: A slide's facts name their slide]
- [ ] AC-9: A transcript line matching a slide's distinctive terms carries that slide as a topic. [REQ: Slides reach the copilot through the existing knowledge pipeline, scenario: A transcript line is tagged with the slide it belongs to]
- [ ] AC-10: The digest presents the deck's slides in order with their facts. [REQ: Slides reach the copilot through the existing knowledge pipeline, scenario: The digest carries the slides and their facts]
- [ ] AC-11: With no deck configured, every knowledge artifact is byte-identical to before. [REQ: Slides reach the copilot through the existing knowledge pipeline, scenario: A project with no deck is unchanged]
- [ ] AC-12: `set-copilot deck` prints the slides in order with titles and facts, and names what failed to extract. [REQ: The extraction is inspectable before it is relied on, scenario: An operator can read the extracted slides]
