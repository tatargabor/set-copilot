## Context

See proposal.md — Why. Three facts about the existing system shape the approach.

`knowledge.sources` resolves `.md` only (`resolveSources`' default extension), so a deck
cannot reach the pipeline today however it is written. The pipeline itself is already the
right shape: `run-digest.ts` resolves an adapter and writes three artifacts — a keyword
index the capture reads, a structured context, and a digest the skill loads at session
start. And the alert taxonomy already says what to do with a contradicted fact: *"cite the
exact source"*. Nothing about the copilot's judgement needs changing; it has never had the
document to judge against.

The verification is a closed loop, which is why the harness was built first: `m-asp-osszeg`
is missed on 3/3 baseline runs, and the noise band (±0.223 coverage) says what would count
as a real change.

## Goals / Non-Goals

**Goals:**

- A deck reaches the copilot's knowledge with its slide structure intact.
- A spoken number can be checked against a slide's number cheaply enough to happen live.
- An operator can see what was extracted before a meeting depends on it.

**Non-Goals:**

- Seeing the presenter's screen. The copilot infers the slide from what is said. Claiming
  otherwise would be a false capability, and the fix for that is a different change.
- A deck viewer, renderer, or screenshotter.
- Deciding who is right. The deck is a reference, not an oracle.
- PDF and PPTX in this change. They are real formats and worth having; they need binary
  parsing and a dependency decision, and the measured gap does not wait on them.

## Decisions

### D1 — Format handling is engine; which decks, and their domain, is config

"Get text out of an HTML file" is a *format* concern and generalises; "the ASP slide says
21,8 milliárd" is a domain concern and must not. So the extractors live in `src/`, and
`knowledge.deck` names the files. This is the same line the repo already draws for
`detect.*` (regex mechanism in code, patterns in config).

Shipping zero extractors would satisfy the letter of "everything project-specific is
config" and produce a feature that does nothing out of the box, which is the failure mode
in the opposite direction.

### D2 — Slides, not pages, and identity is the point

A slide carries position + title. The unit matters because the *citation* matters: an alert
that says "the knowledge base says 21,8" cannot be acted on in a live meeting, and one that
says "slide 11 (ASP három állapot) says 21,8 milliárd" can. Position is taken from deck
order, and deck order from the configured file order plus any leading number in the
filename — decks are named `01-…`, `02-…` precisely because their order is meaningful.

### D3 — Numeric facts are extracted, not left in prose

The measured miss is a number. Asking the copilot to re-read a whole deck mid-sentence to
find one is asking it to do, per utterance, the expensive thing the digest exists to avoid.
So numbers are pulled out with their scale word and a window of surrounding words.

This is a *shape* matcher, not a parser: it will over-collect (page numbers, version
strings) and that is the correct direction to fail. A spurious fact costs a line of digest;
a missed one costs the alert this change exists to produce. The same reasoning as the
wall's redaction walk, pointed the other way — there, over-withholding is safe; here,
over-collecting is.

Number formats are locale-plural on purpose: `21,8` and `21.8` are the same figure in
different conventions, and a deck and a speaker may not share one.

### D4 — Delivered through the existing artifacts, with no new consumer

Slides become keyword topics (so a line is tagged with its slide through machinery that
already exists), context entries, and digest sections. Adding a fourth artifact or a new
prompt block would mean every consumer has to learn about decks; routing through the three
that exist means the skill, the capture, and the wall need no change at all.

### D5 — `set-copilot deck` exists for the same reason the scenario timeline does

An extraction nobody has read fails silently and in the worst direction: the copilot says
nothing, and silence is indistinguishable from a quiet meeting. The subcommand prints the
slides and facts, and names what failed to extract.

## Risks / Trade-offs

- **Over-collection of numbers.** Page numbers, version strings, and years become "facts".
  → Deliberate (D3), bounded by a per-slide cap so one dense slide cannot flood the digest,
  and visible via `set-copilot deck`.
- **A large deck bloats the digest**, which is loaded into every session. → Facts are
  capped per slide and slide text is summarised rather than dumped; the digest already has
  this property for other sources, and `set-copilot deck` shows the real size.
- **HTML extraction is heuristic.** A deck built by a tool nobody anticipated may extract
  to little. → It reports rather than failing silently (a spec requirement), and the
  operator sees it before the meeting.
- **The copilot may now cite a slide for something the speaker never contradicted** —
  noise in the other direction. → Precision is a measured dimension with a declared noise
  band; if it degrades beyond the band, that is a measurable regression, which is the
  entire reason the harness came first.
- **A deck is confidential.** Its contents enter the digest, and the digest reaches the
  wall producer. → Public-zone redaction already governs what reaches a public wall; this
  change adds no new path to a public surface, and the `[belső]` convention applies to deck
  content exactly as to any other knowledge.

## Migration Plan

Additive. A project with no `knowledge.deck` produces byte-identical artifacts, which is a
spec scenario rather than an assumption. Rollback is removing the config key.

Order: extraction and facts first (pure, testable), then the pipeline wiring, then the
subcommand, then the harness re-run against the existing baseline.
