## Why

The copilot stages predictions and **never promotes one**. Measured across four real-time
runs of the `reference` scenario: 2, 3, 2 and 7 visuals drawn ahead into the private
staging box, **zero** lifted to the public wall. The most demonstrable thing the product
does — draw the next picture before it is asked for — has never been seen by an audience.

The mechanism works. `promote` is implemented, gated, and tested; the server keeps a live
registry of what is promotable. The gap is that the producer cannot use it:

- **The drawing contract never teaches the `promote` command.** It says a staged visual is
  lifted "only by an explicit promote" and then documents every payload shape *except*
  that one. This is precisely the phantom-convention failure this project already
  documented once, in the opposite direction: a convention the producer is expected to
  follow but is never taught.
- **A staged visual needs an id to be promotable**, and nothing tells the producer to give
  it one.
- **Nothing tells the producer what it currently has staged.** The registry is server-side
  and in memory; the only way to know is to remember. This repo has paid for prompt-held
  memory before — the chat→wall mirror began as a prompt mandate, fell behind in a live
  meeting, and had to become a mechanism.

## What Changes

- **The drawing contract teaches promotion**: the command's shape, the requirement that a
  staged visual carry a `visual` id, and the rule for *when* to promote — the conversation
  arrived at what the prediction anticipated. Never a timer, never a confidence score.
- **The staging registry becomes queryable.** The wall answers what is promotable right
  now — category, visual id, and how long it has left — and `set-copilot wall-staged`
  prints it. The producer asks instead of remembering.
- **An expired prediction stays expired**, as it does today. Asking is not a way to revive
  a stale guess; it is a way to find out one is gone.

## Capabilities

### Modified Capabilities
- `predictive-staging`: the promotion contract the producer is taught, and the ability to
  ask what is currently promotable.

## Impact

- **`src/wall/server.ts`** — a read-only endpoint over the existing registry. No change to
  staging, promotion, expiry, or zoning: those are correct and stay untouched.
- **`src/config.ts`** — the drawing contract's default text gains the promote shape and
  rule. Config, not skill: a project that renames its categories keeps working.
- **`src/cli.ts`** — `wall-staged`.
- **Measurable**: `predictionsPromoted` is a scored dimension, currently 0 across every
  recorded run. It has no noise band yet — one run is a reading, not evidence — so the
  honest claim after this change is "a prediction reached the wall", not "the rate improved".
