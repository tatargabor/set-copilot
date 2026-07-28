## Context

Three separate things have to be true before a Claude Code message reads correctly on the
wall, and today none of them is:

1. `renderText` (`src/wall/public/wall.js:347-349`) builds one `<span class="txt">` and
   assigns `ev.text` with `textContent`. `pre-wrap` (`wall.css:87`, landed `002b3cd`)
   preserves newlines and nothing else.
2. `hooks/wall-mirror.sh` removes fenced code blocks with an awk pass (`:48-51`), applies a
   40-character floor (`:57`), and truncates at 600 (`:59`).
3. The `copilot.mirror` config seam exists (`src/config.ts:121-131`, defaults at `:648`,
   resolution at `:827`) but carries only `enabled` and `category`, so there is nowhere to
   put a policy even if the hook wanted to read one.

Two project rules bound the solution. "Everything project-specific is config, not code" —
filler phrases are a *language* fact, like `detect.urgency` and `transcript.completeWords`,
so they belong in config with HU+EN defaults. And the render vocabulary is closed by design
(`RenderType`) — the reason a presentation box can hold a graph then a chart then an image
is that the set of things it can hold is fixed and known.

The security posture matters more than usual here: today's safety comes from *not*
rendering anything. Adding a formatter removes that accident, so the invariant has to be
made explicit and testable.

## Goals / Non-Goals

**Goals:**
- A Claude Code message reads on the wall the way it reads in the terminal: tables as
  tables, lists as lists, code as code.
- Filler judgement lives in config with sane defaults, expressible as phrases and not only
  as a length.
- Preserve the "no markup from event content, ever" property explicitly rather than
  incidentally.

**Non-Goals:**
- Not a markdown implementation. A deliberately small closed set; anything else is literal.
- No new `RenderType`, no new payload, no per-event formatting flag.
- No styling configuration. Compactness is a design property of the wall, not a knob.
- No change to the transport, the Stop-hook mechanism, the zone model, or redaction.
- Not a fix for mirror *latency* (turn boundary → hook → 200 ms tail). Separate item.

## Decisions

### D1 — Formatting is derived at render time from the plain `text` string

The event schema does not change. The formatter is a client-side pass over `ev.text`.

This is what keeps the blast radius at zero: `normalizeEvent` still validates one string,
server-side redaction in `ingest` still walks one string leaf *before* any formatting
exists, `latest`/`scroll` accumulation is unchanged, and the graph-state replay to a
reconnecting client is untouched. A formatting *payload* would have put structure inside
the redaction walk's reach and required every producer to opt in.

*Alternative rejected:* a `markdown: true` flag on the event. It adds a schema field, and
worse, it makes safety conditional on a producer-set boolean.

### D2 — Two stages: a pure tokenizer (tested) and a DOM builder (not)

`parseWallText(s) → Block[]` is pure, in `src/wall/text-format.ts`, with a closed union of
block/inline node types. It has no DOM dependency and is unit-tested exhaustively —
including every malformed case, since "degrades to literal text" is a spec requirement.

The builder that turns nodes into elements lives with the client (`wall-core.mjs` or
alongside `renderText`) and is verified by running the wall, per the project's test policy.
The tokenizer is where all the decisions are, so this puts the tested boundary in the right
place.

*Alternative rejected:* a markdown library. It brings an open vocabulary (the spec requires
a closed one), a CDN or vendoring problem (the wall already carries an unresolved
`unpkg.com` dependency for Cytoscape — no reason to add a second), and a sanitizer
dependency on top.

### D3 — The safety invariant is "build elements, never assign markup", and it is asserted

The builder uses `document.createElement` + `textContent` for every leaf. No `innerHTML`,
no `insertAdjacentHTML`, no template string interpolation of event content. Two things
enforce it beyond code review:

- the tokenizer never emits a "raw" node type — there is no representation for
  pass-through markup, so the builder has nothing to pass through;
- a lint-style test greps the wall client for `innerHTML` assignments fed by event content,
  keeping the existing two legitimate uses (the pending-overlay chrome at `wall.js:135`,
  the hand-built chart SVG at `:518`, both from engine-controlled strings) from growing a
  third that is not.

This is deliberately stricter than "escape on the way out". Escaping is a property you can
lose in one careless edit; not having a markup path is a property you have to work to lose.

### D4 — Tables render as a real table element, and the box owns the overflow

A markdown table becomes a `<table>` so column alignment is the browser's job, not
character counting — the operator's complaint was specifically about a *character-drawn*
table. Overflow is handled by the containing box (`overflow-x: auto` on the wall line's
content), never by widening the box: the layout's geometry belongs to the layout, and a
wide table must not be able to reshape the wall.

### D5 — Mirror policy is `copilot.mirror` config, resolved by the engine, consumed by the hook

New fields on `MirrorConfig`: `minLength` (today's 40), `maxLength` (today's 600),
`fillerPhrases` (new, HU+EN defaults), `codeBlocks: "keep" | "strip" | "collapse"`
(default `keep`, changing today's behavior deliberately — see the proposal).

`fillerPhrases` follows the `detect.*` precedent exactly: user patterns are validated at
load and a bad entry is dropped with a warning rather than killing the feature. It follows
the `transcript.completeWords` precedent for the empty case: an explicitly empty list means
"suppress nothing but the length floor", while an absent or malformed key falls back to the
defaults. Nothing leaks by suppressing less, so "no rules" is a safe answer here — the
opposite posture from `wall.redaction`.

### D6 — The hook obtains the resolved policy from the CLI, not by parsing config itself

`hooks/wall-mirror.sh` is bash and must not re-implement the resolution order (defaults →
user file → project file → env). It calls a CLI command that prints the resolved mirror
policy as JSON and applies it with `jq`, which the hook already depends on.

Failure posture: if the command fails or returns nothing, the hook falls back to today's
built-in constants and mirrors anyway. Mirroring is a display convenience — losing it
silently because a policy lookup failed would be a worse outcome than mirroring with
defaults. (Note this is the opposite of the redaction seam's fail-closed rule, and for the
opposite reason: nothing is disclosed by mirroring with default filtering.)

Cost: one extra Node startup per turn, on a path that already spawns Node for `wall-emit`.
Acceptable; if it ever isn't, the resolved policy can be written to the runtime dir once at
enable time.

### D7 — Compactness is enforced by the CSS, sized for 1920×1080

Lists get tightened margins and no outer paragraph spacing; a code block gets a slightly
smaller monospace size and no vertical padding beyond one step; a table gets compact cell
padding. The reference target is the operator's actual screen (§A5), not the development
monitor. This is a design property, not a knob (Non-Goals).

## Risks / Trade-offs

- **The formatter becomes a markdown implementation by accretion.** → The closed vocabulary
  is a spec requirement with its own scenario, and the tokenizer's node union is the
  enforcement point: a new construct requires a new node type, which is visible in review.
- **A markup path is reintroduced later by a well-meaning edit.** → D3's grep test.
- **A wide table or long code block dominates the box.** → D4 (contained overflow) plus the
  existing `maxLength` cap; the cap now has a policy home, so a project can tune it.
- **Keeping code blocks makes the wall noisy in a non-coding meeting.** → `codeBlocks:
  "collapse"` exists for exactly that, and the meeting-facing projects can set it.
- **Filler phrases are a blunt instrument** (a legitimate message could contain a filler
  phrase). → Matching is anchored to whole-message classification rather than substring
  presence anywhere; and the length floor stays as the cheap first pass. Word boundaries
  use the Unicode classes the project already mandates, never `\b`.
- **Extra Node startup per turn (D6).** → Measured against an existing spawn on the same
  path; the runtime-dir cache is the documented escape hatch.

## Migration Plan

Additive apart from one deliberate default change: code blocks are retained where they were
previously stripped. That is the point of the change, it is called out in the proposal and
the spec, and `codeBlocks: "strip"` restores the old behavior exactly for any project that
wants it. Everything else defaults to today's values.

Rollback is a revert; no data, no config file, and no runtime artifact is written in a new
format by this change.

## Open Questions

- Should `collapse` render a code block as a one-line marker with a language tag, or as the
  first line plus an ellipsis? Decide during implementation against a real Claude Code
  message; both satisfy the spec.
- Whether the pending-indicator overlay should also use the formatter. Out of scope — it is
  engine-controlled chrome, not event content.
