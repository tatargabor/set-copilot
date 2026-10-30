# Proposal

## Why

The copilot's "brain" — the knowledge digest it reads and the policy it obeys — shipped
through ad hoc commits with no OpenSpec spec, and three specced capabilities (`deck-knowledge`,
`replay-scorecard`, `replay-scenario`) drifted from the code after later fixes. Today the
code is the only source of truth. This is a **retro-spec**: it records what the code already
does, so that the next change to these areas is proposed against a spec instead of against a
reading of `src/`.

## What Changes

- **Specs only. No source, skill, config, or doc change.** Every requirement below describes
  behaviour verified against the current code; nothing is aspirational.
- New capability `knowledge-digest`: the `digest` command, the pluggable knowledge adapter, source
  resolution (dirs, files, globs), automatic topic derivation, keyword seeds and their legacy
  grouped shape, the transcript topic matcher the capture loads, decision-id normalisation,
  the markdown adapter's structured context, and the three runtime-dir artifacts.
- New capability `copilot-policy`: the policy `set-copilot prompt` renders — the alert taxonomy as
  data, alerts as chat-only, the three engagement contracts, the line budget, the web-research
  gate, the reaction-first turn order, the fast-lane teaching, the drawing-contract block, the
  project-owned instructions file, and the section composition rule (opt-in sections only
  append). Narration, mirroring, per-box policy, feedback, wall input and promotion keep their
  existing homes (`live-narration`, `chat-mirror`, `box-policy`, `wall-feedback`, `wall-input`,
  `fork-producer`, `predictive-staging`) and are referenced, not restated.
- `deck-knowledge` (ADDED): how a slide's keyword tags are chosen (distinctive title words,
  short words only when capitalised, a frequency filter), why an export's build identifier is
  not taken as a slide title, and that deck awareness does not depend on the adapter.
- `replay-scenario` (ADDED): the scenario fingerprint covers exactly what changes a score
  (`noiseBand` and `_`-prefixed notes excluded), a scenario may declare its measured noise
  band, and a scenario declares which categories count as reactions.
- `replay-scorecard` (MODIFIED + ADDED): a comparison applies the scenario's noise band and says
  when a difference is only a single-run reading; the judged matching is persisted per moment;
  precision credits every event that addresses a planted moment.

## Capabilities

### New Capabilities

- `knowledge-digest`: turning a project's knowledge sources into the keyword index, the structured
  context and the session digest the capture and the copilot consume.
- `copilot-policy`: the policy document `set-copilot prompt` renders from config — what the copilot
  may speak up about, how loudly, in what order, and how it draws.

### Modified Capabilities

- `deck-knowledge`: adds the slide-keyword selection rule, the build-identifier title rule, and
  adapter independence.
- `replay-scenario`: adds the fingerprint boundary, the declared noise band, and reaction categories.
- `replay-scorecard`: the comparison requirement gains noise-band semantics; adds the persisted
  judgement record and the precision crediting rule.

## Impact

- Files touched: `openspec/changes/retro-copilot-brain/**` and, at archive, `openspec/specs/`
  for the five capabilities above. No code, test, skill, or config change.
- Describes: `src/knowledge/{types,sources,markdown-adapter,keyword-matcher,run-digest,deck}.ts`,
  `src/copilot-prompt.ts`, the `knowledge.*` / `copilot.*` resolution in `src/config.ts`, the
  topic matcher wiring in `src/capture.ts`, `src/replay-scenario.ts`, `src/replay-score.ts`,
  `src/replay-judge.ts`, and the `digest` / `prompt` / `replay-score compare` commands in
  `src/cli.ts`.
