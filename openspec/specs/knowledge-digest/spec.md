# knowledge-digest Specification

## Purpose
Turn whatever a project's knowledge base is — markdown pages, a decisions folder, or a custom
source behind an adapter — into three artifacts in the runtime dir: a keyword index the capture
uses to tag transcript lines with topics, a structured context, and a human-readable digest the
copilot loads at session start. The engine stays knowledge-agnostic; the project's shape lives in
config.

## Requirements

### Requirement: The digest writes three artifacts into the runtime dir

`set-copilot digest` SHALL run the configured knowledge adapter and write three files into the
resolved runtime dir: `keyword-index.json` (a JSON array of `{topic, stems}`),
`knowledge-context.json` (the structured context), and `knowledge-digest.md` (the readable
digest). The runtime dir SHALL be created if absent. The structured context's `generated` field
SHALL be stamped with the time of the run, not by the adapter. The command SHALL print one
summary line naming the adapter and the counts of keywords, decisions, deferred items and
documented domains.

Because the files live in the runtime dir, a session-scoped `SET_COPILOT_DIR` scopes them with
the capture that reads them — the digest and the capture cannot talk past each other.

#### Scenario: A digest run produces all three files

- **WHEN** `SET_COPILOT_DIR=<dir> set-copilot digest` runs against a project with markdown sources
- **THEN** `<dir>/keyword-index.json`, `<dir>/knowledge-context.json` and
  `<dir>/knowledge-digest.md` exist, and `set-copilot path keywords|context|digest` print those paths

#### Scenario: The summary line reports what was found

- **WHEN** the digest completes
- **THEN** one line is printed of the form
  `[set-copilot] digest via "markdown": N keywords, N decisions, N deferred, N domains`

### Requirement: The knowledge adapter is pluggable through config

`knowledge.adapter` SHALL select the adapter. An absent value or `"markdown"` SHALL select the
built-in markdown adapter. Any other value SHALL be treated as a module path relative to the
project root whose default export is a factory `(ctx) => KnowledgeAdapter`; the factory SHALL
receive the project root, the sources, the decisions dir, the seed keywords, the
`autoKeywords` switch and the deferred markers. A module whose default export is not a function
SHALL fail the digest with an error naming the module.

The engine knows nothing about a database, a wiki product, or a naming convention: a project with
a richer source ships its own adapter rather than teaching the package its layout.

#### Scenario: The built-in adapter is the default

- **WHEN** `knowledge.adapter` is absent
- **THEN** the digest runs the markdown adapter and the summary names `"markdown"`

#### Scenario: A custom adapter module is loaded

- **WHEN** `knowledge.adapter` is `"tools/my-adapter.mjs"` and that module default-exports a factory
- **THEN** the digest calls the factory with the adapter context and writes the three artifacts
  from the adapter it returns

#### Scenario: A module without a factory is refused by name

- **WHEN** the configured adapter module's default export is not a function
- **THEN** the digest fails with an error stating that `"tools/my-adapter.mjs"` must default-export
  a `(ctx) => KnowledgeAdapter` factory

### Requirement: Sources resolve directories, files and small globs

`knowledge.sources` SHALL accept, per entry, a directory (walked recursively), a single file, or a
glob supporting `**`, `*` and `?`, resolved against the project root. `**/` SHALL match zero or
more directory levels, while `*` and `?` SHALL NOT cross a path separator. Only `.md` files SHALL
be collected; entries whose name starts with `.` and `node_modules` directories SHALL be skipped.
The result SHALL be deduplicated across entries and sorted. An entry that matches nothing, or a
directory that cannot be read, SHALL be skipped silently rather than failing the digest.

The digest is best-effort by design: a stale glob in the config must not take the session's
knowledge down with it. No glob dependency is added.

#### Scenario: Overlapping patterns yield each file once

- **WHEN** `sources` is `["docs", "docs/**/*.md"]`
- **THEN** every markdown file under `docs/` appears exactly once, in sorted order

#### Scenario: `**/` matches the top level too

- **WHEN** `sources` is `["docs/**/*.md"]` and `docs/a.md` exists
- **THEN** `docs/a.md` is collected alongside files in its subdirectories

#### Scenario: A single star stays in one directory

- **WHEN** `sources` is `["docs/*.md"]`
- **THEN** `docs/a.md` is collected and `docs/sub/b.md` is not

#### Scenario: A pattern that matches nothing is skipped

- **WHEN** one entry names a path that does not exist
- **THEN** the other entries still resolve and the digest completes

### Requirement: Topics are derived from the pages themselves

When `knowledge.autoKeywords` is true (the default), the markdown adapter SHALL derive topic
candidates from every source page: the frontmatter `tags`, `topics` and `keywords` lists (inline,
bracketed, or YAML block form), the first `#` heading, and every `##` heading. A candidate SHALL be
kept only if it is topic-like: 3 to 60 characters after trailing punctuation is trimmed, at most
five words, containing at least one letter, and not a document-furniture heading (such as
`Overview`, `Summary`, `Introduction`, `Background`, `Notes`, `TODO`, `Goals`, `Scope`, `Status`,
`Usage`, `Examples`, `References`, `Appendix`, `Changelog`, `FAQ`, `Requirements`,
`Open questions`, `Next steps`, `Table of contents`), compared case-insensitively. At most 200
derived topics SHALL be added. Hand-written seeds SHALL come first, and a derived topic whose name
equals a seed's topic (case-insensitively) SHALL NOT be added. With `autoKeywords` false the index
SHALL contain the seeds only.

This is what makes a project with ordinary docs useful on day one with an empty `keywords` array.
A furniture heading as a topic would flag half the meeting; a prose heading is a sentence, not a
name.

#### Scenario: A page names its own topics

- **WHEN** a page has frontmatter `tags: [freight, last-mile]`, title `# Logistics` and a heading
  `## Delivery notes`
- **THEN** `freight`, `last-mile`, `Logistics` and `Delivery notes` each appear as a topic in the index

#### Scenario: Furniture and prose headings are skipped

- **WHEN** a page has `## Overview` and `## A heading that is really a whole sentence of prose`
- **THEN** neither becomes a topic

#### Scenario: A seed wins over the derived topic of the same name

- **WHEN** a seed `{topic: "Logistics", stems: ["logisztik", "logistic"]}` exists and a page is titled
  `# Logistics`
- **THEN** the index lists the seed first and contains exactly one `Logistics` topic, with the
  seed's stems

#### Scenario: Derivation can be switched off

- **WHEN** `autoKeywords` is false
- **THEN** the index equals the configured seeds

### Requirement: Keyword seeds are a flat list; named groups are flattened

`knowledge.keywords` SHALL be a flat list of `{topic, stems}` seeds. A legacy object of named
groups (for example `{"partners": [...], "features": [...]}`) SHALL be accepted and flattened into
one list, because the group name never reached the transcript — only `topic` does. An entry
without a string `topic` or with an empty `stems` list SHALL be dropped, and non-string stems
SHALL be removed. The `knowledge` section SHALL merge per key across the user-level and project
configs, so a project can override `sources` without restating the user-level `keywords`.

#### Scenario: A grouped config still loads

- **WHEN** the config declares `keywords: {"partners": [{"topic": "Acme", "stems": ["acme"]}], "features": [{"topic": "invoice", "stems": ["invoic"]}]}`
- **THEN** the resolved seeds are `[{"topic": "Acme", ...}, {"topic": "invoice", ...}]`

#### Scenario: A malformed seed is dropped, the rest survive

- **WHEN** one keyword entry has no `topic`
- **THEN** that entry is dropped and every well-formed entry is kept

### Requirement: The capture tags transcript lines with matched topics

In meeting mode the capture SHALL load `keyword-index.json` from the runtime dir and annotate each
flushed transcript line with a `topics` array of the matched topic labels; dictation (mic-only)
SHALL NOT tag. A stem SHALL match case-insensitively at a word start, where a word character is
any Unicode letter or digit, and SHALL match inside an inflected or agglutinated form (a stem need
not reach a word end). Topics SHALL be deduplicated and listed in index order. A missing or
unparseable index, or entries that are not `{topic: string, stems: string[]}`, SHALL yield no
topics for those entries rather than failing the capture.

Word boundaries are Unicode, never `\b`: `\b` treats `á` as a boundary and silently breaks every
accented language.

#### Scenario: A stem matches an inflected form

- **WHEN** the index holds `{topic: "delivery note", stems: ["szállítólev"]}` and a line says
  `küldd el a szállítólevelet`
- **THEN** the line carries `topics: ["delivery note"]`

#### Scenario: A stem does not match mid-word

- **WHEN** the index holds the stem `voice` and a line says `invoice`
- **THEN** the topic is not matched

#### Scenario: No index, no topics, no failure

- **WHEN** a meeting capture starts and `keyword-index.json` is absent
- **THEN** the capture runs and its lines carry no `topics` field

### Requirement: Entity names become safe stems

A topic derived from a name SHALL have a trailing company-form suffix stripped from both its label
and its stem (`Kft.`, `Bt.`, `Zrt.`, `Nyrt.`, `Kkt.`, `e.v.`, `GmbH`, `Ltd.`, `Inc.`, `s.r.o.`,
case-insensitive), unless stripping would leave fewer than three characters. The stem SHALL be
regex-escaped and SHALL tolerate a space, a hyphen, or nothing between the name's words. A name of
four characters or fewer SHALL additionally require a word end, and a name shorter than three
characters SHALL produce no stem.

A short stem without a word end is a substring trap: it matches inside unrelated longer words.

#### Scenario: A company form is stripped

- **WHEN** a derived name is `Acme Kft.`
- **THEN** the topic is `Acme` and its stem matches `acme-nak`

#### Scenario: A short name needs a whole word

- **WHEN** the topic `IBM` is derived
- **THEN** `call IBM today` matches it and `ibms` does not

#### Scenario: A name too short to be safe yields no stem

- **WHEN** a derived name is `X`
- **THEN** no stem, and therefore no topic, is produced for it

### Requirement: Decision references are recognised without an index rebuild

When `knowledge.decisionIdPrefix` is set (for example `"DEC"`), the topic matcher SHALL also
recognise the prefix followed by an optional `-`, `.` or space and one to three digits not followed
by another digit, case-insensitively and at a word start, and SHALL normalise each to
`<PREFIX>-NNN` (zero-padded to three digits). Decision ids SHALL be appended after the keyword
topics, deduplicated. The prefix alone SHALL NOT match. With no prefix configured, no decision ids
SHALL be produced.

A new decision is referenced by id the moment it exists; requiring a digest rebuild before the
copilot could see it would be a step nobody remembers mid-meeting.

#### Scenario: Spoken and written forms normalise to one id

- **WHEN** the prefix is `DEC` and a line says `as we said in DEC-3 and dec 12`
- **THEN** the line's topics include `DEC-003` and `DEC-012`

#### Scenario: The bare word is not a reference

- **WHEN** the prefix is `DEC` and a line says `the decision was made`
- **THEN** no decision id is produced

### Requirement: The markdown adapter builds a structured context from the pages

The markdown adapter's structured context SHALL contain:

- **decisions** — one per `.md` file in `knowledge.decisions` (relative to the project root), in
  file-name order, with `id` from frontmatter or the file name, `title` from frontmatter or the
  first heading, and `summary` as the first non-heading paragraph (whitespace-collapsed, at most
  240 characters). A decision whose frontmatter `status` is `superseded` SHALL be skipped. An
  absent or non-directory decisions path SHALL yield no decisions.
- **deferred** — every source line matching any `knowledge.deferredMarkers` pattern
  (case-insensitive), with list and quote markers stripped, at most 200 characters, its source
  file, and the first ticket-like id on the line (`ABC-123`, `M2-REQ-12`) when present; at most
  100 items. An absent or empty marker list SHALL fall back to the shipped defaults
  (`deferred: <x>`, `out of scope`, `postponed`, `won't do/fix`, `TBD`).
- **domain FAQ** — for each source page with at least one `##` heading, its title (or file name)
  and up to eight of its `##` headings.
- **recent incidents** — up to 30 one-line commits from the project's own git history in the last
  30 days whose message contains `fix`; no git repository or a git failure SHALL yield none.

#### Scenario: A superseded decision is left out

- **WHEN** the decisions dir holds `DEC-001.md` (no status) and `DEC-002.md` with `status: superseded`
- **THEN** the context lists `DEC-001` and not `DEC-002`

#### Scenario: A deferred line carries its ticket id

- **WHEN** a page contains `- REQ-42 is out of scope for this release`
- **THEN** the context has a deferred item with `req: "REQ-42"` and that page as its source

#### Scenario: Unused markers find nothing

- **WHEN** no source line matches any configured marker
- **THEN** the deferred list is empty

### Requirement: The digest says so when it has nothing

The markdown digest SHALL render only the sections that have content — decisions, deferred /
out-of-scope, a page index, recent fixes — and when none do, SHALL state that no knowledge sources
resolved and name `knowledge.sources` as the key to set, rather than emitting an empty document.

An empty digest is indistinguishable from a project that has nothing to say; a sentence naming the
missing config is not.

#### Scenario: A project with no sources is told why

- **WHEN** `knowledge.sources` is empty and no decisions dir is configured
- **THEN** `knowledge-digest.md` contains the `# Knowledge digest` heading and a line saying no
  knowledge sources resolved and to set `knowledge.sources`
