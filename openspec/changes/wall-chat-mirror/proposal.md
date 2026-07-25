## Why

The wall has two text surfaces (`én → szöveg`, `fal → szöveg`) that carry very little
data, while the copilot's real substance lives in the chat — where an audience at the
wall cannot see it. Today nothing crosses that gap automatically, by deliberate design
(chat is the primary voice, the wall a secondary artifact). Operators now want an
*opt-in* way to also show the chat on the wall for the people watching it, without
losing the default separation or the public-zone redaction that protects it.

## What Changes

- **New opt-in chat→wall mirroring, enforced by a `Stop` hook.** When enabled, a `Stop`
  hook (`hooks/wall-mirror.sh`, installed by `set-copilot init`) mirrors the copilot's
  last message to a wall text box every turn, through the same `ingest` redaction funnel,
  with code-block/short-filler filtering and dedup. Enforcement is a hook, NOT a prompt
  mandate — a field meeting measured that a prompt-only mandate falls behind. Off by
  default (a per-session opt-in marker gates the hook).
- **Enable at session start.** Mirroring is switched on when the meeting copilot starts
  with `mirror` (in the spirit of the existing `wall` switch): the skill writes the opt-in
  marker and exports `COPILOT_MIRROR=1` so the policy shows the mirroring block.
- **New `chat-wide` layout.** A named layout tuned for mirroring: a big chat box on the
  **left half**, the visual area on the **right half**. Pure geometry — a `wall.layouts`
  entry, no engine change. Named `chat-wide`, NOT `mirror`, so the layout id never collides
  with the `copilot.mirror` feature (a field session proved that collision costs confusion),
  and it ships with no unfilled dead region (a pinned-summary box is deferred to the wall
  backlog).
- **Runtime layout switching.** The active layout can be changed mid-session (not only
  at start), so an operator can flip into (or out of) the mirror layout while the wall
  is live.

## Capabilities

### New Capabilities
- `chat-mirror`: opt-in mirroring of the copilot's substantive chat lines to a wall
  text box, gated on a session-start switch and passed through public-zone redaction;
  off by default.

### Modified Capabilities
- `display-layout`: add the named "mirror" layout (left-half chat + right upper ⅔
  visuals + right lower ⅓ summary) and support changing the active layout at runtime.

## Impact

- **Config:** a new `copilot` mirroring flag (opt-in) and a new `wall.layouts` entry;
  a start-time argument on the meeting-copilot skill; a runtime layout-switch path.
- **Code:** the wall server / layout resolution (`src/wall/layout.ts`, `wall-core.mjs`)
  for the runtime switch; the emit/ingest path is reused unchanged so redaction still
  applies. No new capture and no new render type — mirroring reuses the existing text
  render and the `ingest` funnel.
- **Skills:** `meeting-copilot/SKILL.md` gains the start-time opt-in and the
  layout-switch mechanics; judgement (what is worth mirroring) stays config-driven.
- **Docs:** the display-model note in CLAUDE.md (window → layout → box) already frames
  this as layout-is-geometry / box-is-content; the change stays inside that model.
