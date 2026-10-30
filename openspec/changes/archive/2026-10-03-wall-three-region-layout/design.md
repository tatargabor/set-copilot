## Context

The composition model already has everything this needs — `DEFAULT_LAYOUTS` is geometry,
`DEFAULT_WINDOWS.boxes` is content, `gridTemplate` (`wall-core.mjs:36`) emits
`grid-template-areas` row by row so a repeated name spans naturally, and `behavior:
"latest"` is already replace-on-newer. So the shape the operator asked for is reachable
without touching the engine, which is the point of the layered model.

Two things are genuinely missing. There is no shipped layout with a *third* region (the
`chat-wide` layout deferred it deliberately, `src/config.ts:453-455`), and `badLayout`
(`src/wall/layout.ts:33`) does not check that a multi-cell position is rectangular — a gap
nothing hit while every shipped layout had single-cell positions, and which the first
row-spanning layout walks straight into.

## Goals / Non-Goals

**Goals:**
- Ship the operator's described geometry as config, not as engine special-casing.
- Give reference content a home the stream cannot take away (backlog #9).
- Close the blank-page failure mode that a row-spanning layout would otherwise expose.

**Non-Goals:**
- No new behavior kind. A pinned box is a `latest` box; inventing `pinned` would add a
  synonym and a migration for nothing.
- No new render type. Pinned content is text.
- No draggable splitters — the operator wants them (§B6), and they are a runtime override
  of a layout's track sizes, which is a different change with its own invariant to protect.
- No change to the existing shipped layouts or to any window that does not opt in.

## Decisions

### D1 — The stream column spans both rows; it is not two boxes

`areas: [["szöveg","prezentáció"], ["szöveg","kitűzött"]]` with `columns: ["1fr","1fr"]`
and `rows: ["2fr","1fr"]`.

The left column is one region, not a box per row. That keeps one scroll context — a stream
split across two boxes would make "where is the newest line?" ambiguous, which is the
opposite of what the operator asked for (*"a bal oldali oszlopban csak az üzenetek
mennek… egy folyamatos üzenőfal"*).

Row proportions follow the description (*"a magasság kétharmadába vagy felébe … egy
rajzolható diagram, az alatt pedig egy szövegdoboz"*): the canvas is the hero, the pinned
box takes what is left. Both are explicit track sizes rather than behavior-derived
(`rowSize`), because a layout that declares `rows` should own them.

### D2 — The pinned box is a `latest` box with **no** pacing

`rowSize` (`wall-core.mjs:17`) reads `latest` + `pacing` as "this is the paced hero canvas"
and gives it `2fr`. The pinned box must not carry pacing: it is not a canvas competing for
dwell time, and a director swap on it would be exactly the "content moves on its own"
behavior the region exists to prevent. Its geometry comes from the layout's explicit `rows`
anyway, so pacing would have no upside and one clear downside.

*Alternative rejected:* a new `behavior: "pinned"`. It would be a synonym for `latest`
without pacing, forcing a change in `rowSize`, the client dispatch, and every config
consumer, to express something the existing vocabulary already says.

### D3 — Rectangularity is checked in `badLayout`, next to the other structural checks

The check: for each position, take the min/max row and column of its cells and assert every
cell in that bounding box carries the same name. Cheap, total, and it lives beside the row
width and track-count checks so a reader finds all the structural rules in one place.

Posture matches the module: warn with the offending position named, drop the window, let
the other windows resolve. A layout the browser will reject must never reach the browser —
the failure is not degraded rendering, it is a blank page indistinguishable from a dead
server.

*Alternative rejected:* validating in the client. The client cannot warn anywhere the
operator will look, and the server would still have broadcast a window it knows is broken.

### D4 — The pinned category is new; the box policy says what belongs there

A dedicated category (rather than reusing `súgás`/`narráció`) so that a producer's choice
to pin something is explicit and a project can route it elsewhere purely in config. The
box's `policy.instructions` carry the judgement — agenda, open questions, decisions, tasks;
replaced as a whole; changed occasionally, not continuously — following the existing
box-policy pattern where the private hint box and the public narration box differ by
*mandate*, not by zone.

The public wall gets the region too. It is the operator's stated use (*"kipinelve a
feladatok, amiket meg kell csinálni"* on the shared screen), and public-zone redaction
applies to it exactly as to any other event, since nothing about this path bypasses
`ingest`.

### D5 — "Replace the whole content" is a property the producer must be told about

A `latest` box replaces on newer, so an update that carries only the changed line silently
discards the rest. That is a producer-facing fact, so it belongs in the skill and the box
policy, not in the engine: the copilot emits the pinned block in full each time. Stated
here because it is the one way this region is easy to use wrongly.

## Risks / Trade-offs

- **The pinned box becomes a second stream** (updated every turn until it is noise). →
  D4's policy states the cadence explicitly, and `latest` means a too-frequent update is
  self-limiting rather than accumulating.
- **A partial update wipes the pinned list.** → D5: the skill emits the block whole; worth a
  scenario during verification, not a mechanism.
- **The new layout is not what the operator meant.** → The proportions are the one soft
  part; they are explicit track sizes in config, so changing them is a config edit and the
  operator can be shown it live.
- **Rectangularity validation rejects a layout someone relied on.** → No shipped layout has
  a multi-cell position today, so the check cannot reject anything currently in use; a
  custom layout it rejects was already producing a blank page.

## Migration Plan

Additive. The new layout is an extra `DEFAULT_LAYOUTS` entry and no existing window changes
its `layout` id unless we deliberately switch a default window to it — decide that during
apply, with the fallback being that the layout ships available-but-unused and the operator
switches at runtime (already supported). The new validation cannot reject any layout in use
today. Rollback is a revert.

## Open Questions

- Should the private window switch to the new layout by default, or keep
  `private-staging` (which owns the staging lane) and offer the three-region layout as the
  runtime switch? Leaning toward keeping `private-staging` as the default and making the
  new layout the default for the **public** wall, where there is no staging lane to lose —
  confirm during apply.
- Whether the pinned region should show a "last updated" stamp. Deferred: it is chrome, and
  the operator did not ask for it.
