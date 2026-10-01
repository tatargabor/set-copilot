## Why

The copilot's answers are read on screen, which forces the operator to keep their eyes on the
terminal — during a meeting, while driving the wall, or while dictating, that is exactly when
attention is scarcest. Reading the answer aloud frees the eyes; but reading the *terminal* answer
aloud is useless (code fences, paths, tables, nine-item reports), and summarizing it with a second
model call would put a fork on the latency path — the very cost the session cannot pay. This change
adds a spoken channel that is derived from the same single generation, at no extra model call.

## What Changes

- **A new `speak-follow` process** follows the Claude Code session transcript and speaks each new
  assistant text block as it is written. It is a follower, NOT a `Stop` hook: the hook the chat→wall
  mirror replaced was permanently one message behind and could never deliver a turn's closing
  summary. Spoken, that defect becomes "you hear the previous answer" — unusable rather than merely
  lossy.
- **Two-tier selection of what is spoken, with no second model call.** A message may carry a short
  model-written spoken lead (same generation, ~15 tokens, zero added latency); when it does not, a
  pure mechanical extractor derives one (leading sentences to a character cap, with code fences,
  tables, paths and URLs removed).
- **A hard length ceiling, not chunking.** Where the mirror divides a long message into consecutive
  wall events, speech truncates: the remainder stays in the terminal. The second chunk of a spoken
  nine-item report is never listened to.
- **Feedback suppression.** While a capture owns the runtime dir, speech is held — otherwise the
  microphone transcribes the machine's own voice and the copilot receives its own words as user
  input. This is a required behavior, not an option.
- **Barge-in.** A newly written message cuts the utterance in progress rather than queueing behind
  it; the fresh answer is the one that matters.
- **A runtime toggle** — `set-copilot speak on|off`, a marker file re-evaluated per pass, so voice
  can be switched mid-session without restarting anything. Off by default.
- **The engine is config** (`speech.engine`), and this change ships two: **Google Cloud TTS with the
  `hu-HU-Chirp3-HD-Achernar` voice as the default**, and macOS `say` as the fallback for when there
  is no credential, no network, an API error, or a synthesis too slow to be worth waiting for. The
  cloud engine is the default because a listening test rejected the local Hungarian voice, and a
  spoken channel nobody enjoys listening to does not get used. Credentials come from env / `.env`
  only, never committed config — the rule `SONIOX_API_KEY` already follows.

Non-goals, stated so they are not read in: no second model call anywhere on the speech path, no
Linux engine, no spoken *input* (that is `/ds`), no change to what the terminal shows — the terminal
stays the full, detailed channel and speech is a strict subset derived from it.

## Capabilities

### New Capabilities
- `spoken-output`: reading the session's assistant messages aloud — the follower and its ownership
  of the runtime dir, the opt-in gate, the two-tier selection of what is spoken, the length ceiling,
  capture-feedback suppression, barge-in, and the configured engine seam.

### Modified Capabilities
<!-- None. `chat-mirror` is untouched: the speech path reuses its exported parsing helpers but adds
     no requirement to it and changes none of its behavior. -->

## Impact

- **New code**: `src/speak-follow.ts` (the process: transcript resolution, offset, PID ownership,
  gating, log), `src/speak-policy.ts` (pure, unit-tested: the two-tier selection and the ceiling),
  `src/speak-engine.ts` (the engine seam + the `say` implementation).
- **Reused, unchanged**: `parseMirrorables` and `resolveTranscriptPath` from `src/mirror-follow.ts`
  are already exported and are used as-is.
- **`src/config.ts`**: a new `speech` section (engine, voice, rate, character ceiling, the marker's
  default). Language-specific and project-specific values are config with defaults, per the repo's
  standing rule.
- **`src/cli.ts`**: `speak-follow`, `speak on|off`, and `doctor --speak`.
- **Runtime dir**: adds `speak.pid`, `speak-offset`, `speak.log`, `speak.enabled` alongside the
  capture's and the mirror's files. `stop` gains a speech-stop step; `set-repair` gains an orphan
  report for `speak.pid`.
- **Prompt/policy**: the spoken-lead convention is rendered by `set-copilot prompt` from config, not
  written into a skill — a project must be able to change or disable it without forking the skill.
- **Credentials**: a `GOOGLE_TTS_API_KEY` (or service-account) lookup in env / `.env`, alongside
  `SONIOX_API_KEY`. Nothing new is committed; `.env` is already gitignored.
- **Platform**: the fallback engine is macOS-only. On any other platform a cloud failure has nothing
  to fall back to, and `doctor` reports which engines resolved rather than leaving it a mystery.
- **Privacy**: with the cloud engine active, the spoken lead of each answer is transmitted to Google.
  `speak on` names the active engine and says so; the local engine remains a complete alternative.
- **Relation to `wall-mirror-follower`**: the applied `openspec/specs/chat-mirror/spec.md` still
  describes the `Stop` hook because the change that replaces it (`wall-mirror-follower`, which
  `## REMOVED`s that requirement and adds the `mirror-follower` capability) is not archived yet.
  This change neither depends on it nor conflicts with it — `spoken-output` is a new capability and
  modifies no existing requirement — so the two can archive in either order.
