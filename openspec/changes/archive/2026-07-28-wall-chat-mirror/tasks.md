## 1. Config seams

- [x] 1.1 Add a `copilot` mirroring flag (default off) plus a target text-box/category id in `src/config.ts`, with defaults and merge coverage
- [x] 1.2 Add the `chat-wide` layout to the default `wall.layouts` (big left chat column + equal right visuals column; named `chat-wide` NOT `mirror` to avoid colliding with the `copilot.mirror` feature; no unfilled dead region) in `src/config.ts`
- [x] 1.3 Config tests: mirroring flag resolves off by default and can be enabled; the `chat-wide` layout resolves to the expected grid proportions

## 2. Runtime layout switch

- [x] 2.1 Add a `wall-layout <route> <layout>` CLI verb that emits a layout-switch control event into the runtime dir's wall log / SSE
- [x] 2.2 Server (`src/wall/server.ts`): validate the requested layout id against the registry, broadcast the switch, ignore unknown ids with a warning (no blanking)
- [x] 2.3 Client (`wall.js` / `wall-core.mjs`): on a switch event, re-derive `grid-template-*` for the target window and keep every box's state
- [x] 2.4 Layout-resolution tests: switching to a known layout re-derives the grid; an unknown id is ignored, not rendered blank

## 3. Chat mirroring behavior

- [x] 3.1 Verify mirrored `text` events flow through the existing `ingest` funnel unchanged (redaction + per-delta zoning) — no new emit path
- [x] 3.2 Redaction test: a mirrored public-zone line matching a pattern is redacted/withheld fail-closed, identical to any other event

## 4. Stop-hook enforcement (field-corrected)

- [x] 4.1 Ship `hooks/wall-mirror.sh` in the package (last-message → wall, code-block strip, <40-char filler skip, 600-char cap, dedup stamp), self-gated on `wall.pid` + `wall-mirror.enabled` marker
- [x] 4.2 Add `hooks` to `package.json` `files`
- [x] 4.3 `set-copilot init` copies the hook into `.claude/hooks/` and idempotently registers a `Stop` hook in `.claude/settings.json` (project + `--global`)
- [x] 4.4 Reframe the `## Mirroring` prompt block: the hook mirrors, the copilot keeps chat substantive and does NOT emit the mirror itself (avoid doubling)
- [x] 4.5 Test: `registerStopHook` is idempotent (adds once, no-op on re-run, preserves other settings, tolerates malformed JSON)

## 5. Skill + start-time opt-in

- [x] 5.1 `meeting-copilot/SKILL.md`: add the `start ... mirror` opt-in word; create the `wall-mirror.enabled` marker + export `COPILOT_MIRROR=1`; name the `Stop`-hook enforcement
- [x] 5.2 `meeting-copilot/SKILL.md`: the hook mirrors — the copilot must NOT emit the mirror itself; keep chat substantive; `[belső]` for internal spans
- [x] 5.3 `meeting-copilot/SKILL.md`: document switching into/out of the `chat-wide` layout at runtime via `wall-layout`

## 6. Verification

- [x] 6.1 `npm run build` clean (tsc strict) and `npm test` green
- [x] 6.2 Manual CLI check: wall runs from another project, a mirrored line appears + is redacted on the public view; runtime layout switch to `chat-wide` with no restart and no state loss
- [x] 6.3 Resolve the design open question (reuse `narráció` vs dedicated `tükör` category) and reflect the choice in config + skill
