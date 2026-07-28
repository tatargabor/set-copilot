## Context

The copilot IS the Claude Code session; there is no separate process that "sees" the chat.
So mirroring chat to the wall cannot be a passive tap — it has to be the session itself
also emitting its substantive lines through the normal `wall-emit` → `ingest` path. The wall
already has everything needed to *show* such lines (a text render, text boxes, the redaction
funnel); what it lacks is (a) an opt-in that turns the behavior on for a session, (b) a layout
that gives the mirror real estate, and (c) the ability to switch into that layout while the
wall is already live. The display model (window → layout → box position → box) and the
"layout is geometry, box is content" separation are the frame this must stay inside.

## Goals / Non-Goals

**Goals:**
- An opt-in, off-by-default way to also show the copilot's substantive chat on the wall.
- A named `mirror` layout: large chat box on the left half, visuals on the right upper ~⅔,
  a summary box on the right lower ⅓.
- Switching the active layout of a *live* window without restarting the wall server.
- Public-zone redaction applies to mirrored content exactly as to any other event.

**Non-Goals:**
- No automatic mirroring by default — the chat-primary / wall-secondary separation stays.
- No new render type, no new box kind, no new capture. Mirroring reuses `text` + `ingest`.
- No verbatim mirroring of every chat token — only substantive lines, judged by the skill.
- No per-line confidence model; enablement is a single session-level opt-in.

## Decisions

**1. Mirroring is enforced by a `Stop` hook, not agent discipline.** When the opt-in is on, a
`Stop` hook (`hooks/wall-mirror.sh`, installed by `set-copilot init`) takes the turn's last
assistant message and emits it as a mirror event. Rationale — **corrected by field data**: an
earlier draft made this the session's own job (the prompt asks the copilot to `wall-emit` each
line). A live meeting measured that a prompt-only mandate *repeatedly falls behind* — the chat
carried far more than the wall, and mirroring is not retroactive. The hook closes the gap
structurally: whatever the copilot said last is mirrored, every turn, or nothing. The hook does
the noise-filtering the prompt used to ask for — strip fenced code blocks, skip sub-40-char
filler, cap length, and dedup against the last emission (a per-session stamp file) — all
learned from the live hook that this generalizes. The prompt block is reduced to "keep the chat
substantive; the hook mirrors what you say; don't emit it yourself" so the two never double.

**1b. The wide layout is `chat-wide`, not `mirror`.** A field session switched `wall-layout /wall
mirror` and assumed the *echo* feature was on, because the layout id and the `copilot.mirror`
feature share the word — the wall stayed empty and it cost real confusion. So the layout is named
`chat-wide` (geometry: big chat column left, visuals right, equal split) and `mirror` names only
the feature. The layout also ships with NO unfilled position — an earlier draft added an
`összefoglaló` third region with no default box, which rendered as a dead region (part of the same
"empty wall" confusion). A dedicated pinned-summary box is deferred to the wall backlog rather
than shipped empty.

**2. Reuse `ingest`, never a new path.** Mirrored events go through the same server-side
`ingest` funnel as every other event, so public-zone redaction and per-delta zoning apply
unchanged. Rationale: `redaction.ts` is fail-closed precisely because it is the *only* place
that catches every producer; a second emit path would be a second leak surface. The mirror adds
zero redaction code.

**3. `mirror` layout is pure config.** It is a new `wall.layouts` entry — a grid with a
left column (large) and a right column split into an upper (~⅔) and lower (⅓) region — exactly
like the shipped `third-two-thirds`. No engine change: the CSS-Grid substrate already expresses
arbitrary column/row proportions.

**4. Runtime layout switch = a control event over the existing SSE.** A new `wall-layout
<name>` CLI verb emits a control event; the server validates the id against its layout registry
and broadcasts it; `wall-core.mjs` re-derives `grid-template-*` for the target window client-side
and keeps every box's state. Rationale: a layout is already a pure function of config → grid
template, so switching is just recomputing that template with a different id — no box teardown,
no server restart. An unknown id is ignored with a warning (consistent with the existing
"unknown layout is dropped, not rendered blank" requirement). Alternative (restart the server
with a new default layout) was rejected: it drops live accumulated state and the user explicitly
wants mid-session switching.

**5. Start-time opt-in mirrors the `wall` switch.** `/meeting-copilot start wall mirror` sets a
session flag; `copilot` config carries the default (off) and the target box id. The skill owns
the "echo substantive chat" mechanic; the project config owns "what is substantive" and "which
box." Consistent with the existing start-time `wall` word.

## Risks / Trade-offs

- **Double-emission noise** (every substantive chat line now also on the wall) → the skill
  already suppresses filler; mirroring inherits that discipline, and it is off by default.
- **A sensitive chat line reaching the public wall** → same mitigation as all wall content:
  `ingest` redaction is fail-closed, and `zone:"private"` / `[belső]` remain the reliable
  guarantees. Mirroring adds no bypass.
- **Runtime switch races with in-flight renders** → the switch only re-derives geometry; box
  content/state is untouched, so a mid-flight render simply lands in the re-arranged grid.
- **Layout id typo at switch time** → validated against the registry; unknown ids are ignored
  with a warning, never blanking the window.

## Migration Plan

Purely additive: off by default, no existing config changes meaning. Existing windows and
layouts render identically. Rollback is not enabling the flag (behavior) and not shipping the
`mirror` layout entry (config). The `display-layout` MODIFIED requirement relaxes the old
"switch takes effect on restart only" clause to *allow* runtime switching; it does not require
any existing window to change.

## Open Questions

- ~~Reuse `narráció` or a dedicated category?~~ **Resolved:** a dedicated `tükör` category, so
  mirroring and narration coexist and are zoned independently.
- Deferred to the wall backlog (out of scope here): a pinned/`latest` summary box for the
  `chat-wide` right-lower region (a field request — the scrolling log buried the open-questions
  list); auto-reconnect for a dropped SSE client; and a "drawing…" placeholder for cold-start
  wall latency. These are separate changes, tracked in the post-field backlog.
