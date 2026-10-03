# Proposal

## Why

The live transcript — the JSONL a capture writes and a Claude Code session polls — and the
spoken-command fast lane shipped through a series of ad hoc commits with no OpenSpec spec, and two
existing specs (`transcript-poll`, `transcript-stitch`) have drifted behind the code. Today the
code is the only source of truth. This is a **retro-spec**: it writes down what the code already
does, so that OpenSpec can lead the next change to this path instead of trailing it.

## What Changes

- Specs only. **No source code changes**, no behaviour changes, no config changes.
- New capability `live-transcript-format`: the line format the capture writes (flush rules,
  per-channel independence, `startTs` / `partial` / `cont` / `midWord`, `topics` / `urgency` /
  `question` / `command` flags, the silence event, configurable detection with a fail-soft regex
  loader, Unicode-aware name and keyword matching).
- New capability `fast-lane-commands`: bracketed spoken commands read from the token stream,
  their `command` / `command-abandoned` events, the caps, the configuration, and the policy text
  that tells the copilot how to act on them.
- Modified capability `transcript-poll`: the offset advances over everything read (including
  lines the filter dropped), the early-return set includes fast-lane events and requires speech
  for a silence to count, and the batch filter (echo dedup, empty lines, event pass-through) and
  the 250 ms tick are specified.
- Modified capability `transcript-stitch`: the clock repair is per channel, speakerless events no
  longer drive the timeline, and a recording whose clocks restarted more often than a rotation
  explains falls back to recording order with a stated note (commit `2835e5d`). The ordering and
  overlap requirements gain the matching exception.

## Capabilities

### New Capabilities

- `live-transcript-format`: what a capture writes into its transcript JSONL while it runs — when a
  line is cut, which fields it carries, and how the per-line flags are detected.
- `fast-lane-commands`: a spoken instruction bracketed by a start and an end word, extracted from
  the token stream and handed to the copilot without the ambient inference gate.

### Modified Capabilities

- `transcript-poll`: offset semantics corrected to what the code does; early-return triggers
  extended with fast-lane events and the speech condition on silence; batch filtering and tick
  granularity added.
- `transcript-stitch`: rotation repair made per channel; speakerless events excluded from the
  timeline; a recording-order fallback for clocks that cannot be trusted.

## Impact

- `openspec/specs/live-transcript-format/`, `openspec/specs/fast-lane-commands/` (new),
  `openspec/specs/transcript-poll/`, `openspec/specs/transcript-stitch/` (updated).
- Code described (not changed): `src/transcript-writer.ts`, `src/fast-lane.ts`,
  `src/knowledge/keyword-matcher.ts`, `src/poll.ts`, `src/copilot-prompt.ts`,
  `src/transcript-build.ts`, `src/config.ts` (`detect.*`, `copilot.names`, `copilot.fastLane`).
