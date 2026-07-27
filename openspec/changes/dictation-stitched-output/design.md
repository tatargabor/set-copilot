## Context

The stitch engine already exists (`src/transcript-build.ts`, `src/transcript-stitch-run.ts`) and
the meeting path uses it. The dictation path was deliberately excluded, and the exclusion was
recorded in two places — the code comment on `handoverAtStop` and the `meeting-transcript-persistence`
spec — with the reasoning: *there the raw text is the user's message, not a document.*

That reasoning correctly rules out writing `.md` and `.jsonl` files for a dictation. It does not
rule out reassembling the text, and conflating the two left the worse half of the problem in
place. `skills/dd/SKILL.md` still says "concatenate the `text` fields", which asks the model to
supply a separator it cannot know:

```
11580 [partial] "…a SetPromo-ból a ide, a"
16140 [cont]    "meetingek át lettek szedve?"
```

`cont` without `midWord` means a space; `cont` with `midWord` means none. Neither fact is visible
to a consumer told only to concatenate.

## Goals / Non-Goals

**Goals:**

- The dictated text reaches the model as sentences, with the separator decided from what the
  capture recorded rather than guessed by a prompt.
- Remove the reassembly obligation from the skills entirely, rather than teaching them the rule.
- Keep the archival invariant untouched — the single `renameSync` remains the one source of truth
  for "handed over exactly once".
- Never lose a dictation to a bug in the new path.

**Non-Goals:**

- Writing derived artifacts for dictation. That decision stands.
- Changing the meeting `stop` output. It already produces the three paths.
- Improving the stitch algorithm. This wires an existing engine into a second consumer.
- Changing `/ds`. It only starts a capture; it parses nothing.

## Decisions

### A separate plain renderer, not the markdown one

`renderMarkdown` emits `**[00:00:11] mic:**` prefixes. For a meeting that is the point; for a
dictation it is contamination — the model would read the timestamp as part of the instruction.
`renderPlain` emits the sentences and nothing else.

It stays a *renderer over the same sentence stream*, not a second reassembly path, so the word
boundary logic has exactly one implementation and the dictation and meeting paths can never
disagree about where a word begins.

Sentences are joined with a single space: a dictation is one continuous utterance, and paragraph
structure is not something the transcript knows.

*Alternative rejected:* stripping the markdown afterwards with a regex. It would have to
understand the very syntax we chose to avoid emitting.

### Only stdout changes; archival does not move

`printTranscriptOnce` reads the file, prints, then delegates to `handoverTranscriptOnce`. The
change replaces *what it prints*. The rename stays exactly where it was and keeps being the sole
handover mechanism — the invariant that a double `/dd` cannot replay a dictation is untouched,
because it never depended on the output format.

Notably the print happens **before** the archive, reading the live file, and that ordering does
not change either.

### Fail open, deliberately — the opposite of the wall's posture

If reassembly throws or yields nothing on a non-empty transcript, the raw contents are printed
instead. This is the reverse of `wall.redaction`, which withholds when in doubt, and the
difference is the direction of harm: on a public wall a mistake *publishes* something, so silence
is safe; here a mistake would *swallow the user's instruction*, and silence is the harm.

A badly joined word boundary is visible to the reader and recoverable. A dictation that vanishes
is not — the user has already spoken and has no copy.

The fallback writes a diagnostic line to stderr, so a persistent failure is noticeable rather
than quietly degrading every dictation back to today's behavior.

### The skills lose the instruction rather than gaining a better one

The most tempting fix — teach `dd/SKILL.md` about `cont` and `midWord` — is the wrong one twice
over. It puts a mechanical rule in a prompt, where it is re-derived probabilistically on every
invocation; and it duplicates logic that already exists in tested code. The instruction is
deleted. What remains is "the output is the user's message, act on it", which is what the skill
was always trying to say.

This is the same separation `CLAUDE.md` states for the copilot: mechanics belong in code and in
the skill's *procedure*, judgement belongs in config. Rejoining a severed word is mechanics.

## Risks / Trade-offs

- **An external caller parses `stop --print` as JSONL** → `printTranscriptOnce` is exported from
  the library, so the shape change is public. Both in-repo consumers are updated here and the
  change is called out; the raw transcript remains on disk under its archived name for anyone who
  wants the structured form.
- **The stitch merges two dictated sentences that should stay apart** → It splits on the
  recognizer's own terminators, which is what today's consumer effectively does too when it
  concatenates. The sentence-merge rule is bounded by the 600-character cap already in the engine.
- **A dictation containing no terminal punctuation becomes one long line** → It already is one
  long utterance; the previous behavior emitted the same words in the same order.
- **Silent regression to raw output** → the fallback logs, so it is observable.

## Migration Plan

- **Rollout**: ship together. A stale installed copy of `dd/SKILL.md` (from an earlier
  `set-copilot init`) would tell the model to parse text that is no longer JSONL — but the
  instruction is "concatenate the text fields", and applied to plain prose it degrades to "use
  the text", which is the intended behavior. The failure mode of a stale skill is benign.
- **Re-running `init`** refreshes the skills; worth mentioning in the change's release note.
- **Rollback**: revert the renderer call in `printTranscriptOnce`; the skills' old instruction
  works against raw JSONL again.

## Open Questions

- Should `--print` gain a `--raw` escape hatch for a caller that genuinely wants the JSONL? Not
  adding one yet: the archived file is right there on disk, and an unused flag is a maintenance
  cost. Worth revisiting if an external consumer appears.
