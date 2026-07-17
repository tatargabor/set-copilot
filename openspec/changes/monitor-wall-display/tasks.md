## 1. Skeleton & event schema

- [x] 1.1 Create `src/wall/` module structure and a `wall` subcommand stub in `cli.ts` that prints usage
- [x] 1.2 Define the category-tagged event schema (TypeScript types): `text` / `graph` events with `category`, `zone`, optional `speaker`, optional `priority:"immediate"`, graph `visual` id + `op:"add"|"reset"`, and director `show` commands (per design D6) — byte-compatible with the `wall-producers` output
- [x] 1.3 Define config/data shapes: category registry (`{id,label,icon,render}`), window (`{route, zones, slots[]}`), slot (`{area, behavior, cats[], pacing?}`)

## 2. Category registry (display-categories)

- [x] 2.1 Resolve categories at startup from config and/or a `categories.mjs` module (mirroring the `knowledge.adapter` seam)
- [x] 2.2 Validate categories: drop invalid ones (missing `id`, bad `render`) with a warning; keep the rest
- [x] 2.3 Unit tests: registry resolution, invalid-category drop, unknown-category event dropped-with-warning

## 3. Wall server & SSE transport (wall-server)

- [x] 3.1 Local HTTP server serving static assets from `src/wall/public/`; windows come entirely from config (`name`, `route`, `zones`, `slots`) — `/` and `/wall` are defaults, adding a window is a config-only change
- [x] 3.2 SSE `/events` endpoint with a broadcast set of connected clients; native auto-reconnect
- [x] 3.3 Per-window `zones` filtering (`private`/`public`/`both`) so a window only renders matching events
- [x] 3.4 Event-source abstraction: the server ingests events from a pluggable source (not a hardcoded producer); multiple concurrent producers merge into one broadcast — the seam the sibling parallel-subagent change plugs into
- [x] 3.4a JSONL append-and-tail ingest: tail a runtime-dir events file that out-of-process producers append to (mirroring `transcript.jsonl`/`poll`); treat the file as the canonical log for broadcast + state-replay, so no producer in-memory state must be reconciled
- [x] 3.5 State-replay on connect: send accumulated graph state + pinned latest items to a late-joining client
- [x] 3.6 `set-copilot wall` starts the server and prints window names + URLs; no cloud account required

## 4. Server-side playout director

- [x] 4.1 Implement the playout policy: min-dwell timer, freshness gate (hold when nothing fresher), priority override (immediate swap); pacing scoped to paced canvas slots only, and events with `priority:"immediate"` broadcast at once without pacing
- [x] 4.2 Make the director authoritative server-side and emit `show` events so multiple walls stay in sync
- [x] 4.3 Unit tests: dwell hold, hold-when-no-fresher, priority-override-bypasses-dwell

## 5. Client layout engine (display-layout)

- [x] 5.1 `wall.js` SSE client: connect to `/events`, parse events, dispatch by category to subscribed slots
- [x] 5.2 Map slot config → `grid-template-areas` and mount one element per slot (vanilla, no framework)
- [x] 5.3 `scroll` behavior: append + autoscroll, history reachable
- [x] 5.4 `latest` behavior: replace-on-newer for its subscribed categories
- [x] 5.5 `latest` + `pacing`: consume server `show` events / apply dwell + cross-fade transition on the canvas slot
- [x] 5.6 Unit test the pure client logic that can be isolated: slot→grid mapping, category→slot dispatch

## 6. Render types

- [x] 6.1 `text` renderer: render an event into a DOM lane, honoring `speaker` (mic/system) visual distinction
- [x] 6.2 `graph` renderer: Cytoscape.js instance, incremental `cy.add()` for `op:"add"`, animated dagre layout (A-path: full-graph relayout, per design D4)
- [x] 6.2a Visual grouping + reset: group graph deltas by `visual` id; on `op:"reset"` (new id) freeze the current visual as a prior candidate and start a fresh one, so the paced director has visuals to swap between (per design D6, (b) decision)
- [x] 6.3 Wire Cytoscape + `cytoscape-dagre` (CDN for the POC; note vendoring decision as follow-up)

## 7. Scripted fake-feed & end-to-end validation

- [x] 7.1 `feed-script.ts`: a predefined timeline emitting text + graph + director events across zones, on a loop with `reset` — implemented as one event-source (task 3.4), proving multiple sources could run concurrently
- [x] 7.2 A demo layout config: private window (pinned riasztás+súgás, scroll transzkript, paced canvas) + public wall (clean summary + paced canvas)
- [ ] 7.3 Run `set-copilot wall`, open `/` and `/wall`, and validate the feel: scroll vs latest, paced-swap dwell/override, incremental graph append, state-replay on a late-joining wall
  <!-- Data path verified end-to-end (SSE zone-filtering, director swaps in sync, replay, JSONL tail);
       browser render (Cytoscape visual, DOM scroll feel) still needs a human at a browser. -->
- [ ] 7.4 Record the A-path layout verdict (acceptable vs needs scoped B-path) to inform the next iteration
  <!-- Requires visual observation of the animated dagre relayout in a browser. -->

## 8. Docs & roadmap

- [x] 8.1 Update `docs/ROADMAP.md` #6: mark the display iteration, note the category/slot/behavior model and the deferred scope (#8 dynamic categories, live Haiku pipeline)
- [x] 8.2 Note the open questions resolved during build (layout-config location, categories inline vs `categories.mjs`, cross-fade, Cytoscape packaging)
