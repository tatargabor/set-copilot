## Why

The spoken-command lane (`src/fast-lane.ts`) opens a command on **any** occurrence of an opening
word, on **any** channel. In a meeting about the copilot, its own name is ordinary speech: one
recorded meeting produced 16 `command-abandoned` events and not one real command, and each false
opening swallowed up to 45 s of speech into a `partial`. The 2026-10-01 field backlog (§2) recorded
the other half: a remote participant's ordinary "start … stop" **completed** a false command, which
the policy tells the copilot to execute.

Measured on that meeting's transcript with `npx tsx scripts/fast-lane-replay.ts` (a line-level
replay, design D4):

| rule | false `abandoned` |
|---|---|
| current | 11 (mic 5, system 6) |
| mic only, `start` dropped (field backlog fix) | 5 (all mic) |
| mic only + the opener must begin an utterance | **0** |

The 5 that survive the field backlog's fix all use the name mid-sentence. A real address begins the
utterance ("Copilot, draw …, csináld."), so the field fix is necessary but not sufficient.

## What Changes

- **Only configured channels can open a command:** `copilot.fastLane.channels`, default `["mic"]`.
- **The opening word must begin an utterance:** nothing but punctuation and whitespace before it
  since that speaker's last `.`/`?`/`!` or a pause of `utterancePauseMs`. `utteranceStart` defaults
  to `true`; `false` restores the previous matching.
- **The default opening words drop `start`** and keep `copilot`. Closing words are unchanged.
- **`scripts/fast-lane-replay.ts`** replays a recorded transcript through the lane and prints the
  counts, read-only, so the measurement comes from a command.
- **The policy text** names the rule, so the copilot can explain a missed command.
- The CLAUDE.md fast-lane paragraph is updated.

Not breaking for configs: absent keys take the new defaults, and a project that relied on `start` or
on the system channel opts back in through config.

## Capabilities

### New Capabilities
- `spoken-command-trigger`: when a spoken command span may open — the channel gate, the
  utterance-start rule, the default opening vocabulary, and the replay measurement.

### Modified Capabilities
None. No existing spec covers the fast lane.

## Impact

- `src/fast-lane.ts`, `src/config.ts`, `src/copilot-prompt.ts`, their tests, and the fast-lane
  fixture in `src/transcript-writer.test.ts`.
- New `scripts/fast-lane-replay.ts`.
- `CLAUDE.md`: the fast-lane paragraph.
- `transcript-writer.ts` is unchanged: it already passes the speaker and token timestamps.
