# Design

## Context

A retro-spec (see proposal.md - Why): every requirement here was read off the code at HEAD
(`src/wall/public/wall.js`, `wall.css`, `transcript.{html,js}`, `src/wall/server.ts`,
`src/wall/emit.ts`, `src/config.ts`, `src/cli.ts`) and the commit messages of 0196660, 3380850,
15c0a07, 14950a2 and 0edb6ff. No code changes.

## Goals / Non-Goals

**Goals:** describe current behaviour precisely enough that the next change to the wall can be
proposed against a spec, and replace the `display-layout` text that the code now contradicts.

**Non-Goals:** fixing anything found along the way. Gaps are recorded below, not repaired.

## Decisions

- **Three new capabilities, not one.** Presentation chrome, the transcript page and the
  screenshot command have different surfaces (browser chrome / an HTTP endpoint plus page / a
  CLI command) and different reasons to change; folding them together would make every later
  delta touch an unrelated spec.
- **Graph attributes split by layer.** The payload shape (`tone`, `parent`, `invisible`, `x`/`y`,
  `image`, `title`) goes to `display-categories`, where payload shapes already live; how a
  graph is laid out and when it counts as manually scaled goes to `display-layout`, as
  MODIFIED blocks that carry every base scenario forward.
- **The transcript page is recorded as outside the ingest funnel and the audience model.**
  That is what the code does; stating it keeps a reader from assuming the
  `public-redaction` ingest-funnel and audience guarantees cover it.
- **`display-categories` Purpose** is written directly into the main spec at sync time, since a
  delta cannot carry a Purpose for an existing capability.

## Risks / Trade-offs

- [A node `image` path is a string leaf, so a redaction match scrubs it into a broken path
  instead of withholding the event, unlike `image.src` / `webpage.url`] → recorded in
  `display-categories`; a follow-up change should decide whether node images join the
  URL-withholding rule.
- [The transcript page's static file is also reachable as a plain asset
  (`/transcript.html`) when no route is set; it can show nothing because `/api/transcript`
  answers 404] → harmless today; worth closing if the page ever embeds data.
- [`wall-shot` leaves the PNG on disk when the emit is refused] → acceptable; with the scoped runtime dir the shot stays inside that
  session's own directory.
- [Line references in tasks.md drift as the files change] → each task also names the function
  or constant it verified.
