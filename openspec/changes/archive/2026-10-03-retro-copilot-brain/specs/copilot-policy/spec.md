## Purpose

Render the copilot's policy — what it may speak up about, how loudly, in what order, how it draws,
and the project's own reading rules — as one markdown document that `set-copilot prompt` prints and
the meeting-copilot skill loads at session start. The skill owns the mechanics; this owns the
judgement, so a project changes what its copilot says from config without forking a skill.

## ADDED Requirements

### Requirement: The policy is rendered from config and composed in a fixed order

`set-copilot prompt` SHALL print the policy rendered from the resolved config. The document SHALL
be composed in this order: the alert categories block (which carries, in turn, the notification
command, the fast-lane block, the turn-order block, the engagement block, the feedback block and
the output format); the wall-input block; the narration block; the mirroring block; the drawing
contract; the per-box policy sections; the project instructions. The wall-input block SHALL always
be rendered. The narration block SHALL be rendered only when narration is enabled (see
`live-narration`), the mirroring block only when mirroring is enabled (see `chat-mirror`), the
feedback block only when `copilot.acknowledge` is not `false` (see `wall-feedback`), and the
per-box sections only when a box declares a policy (see `box-policy`).

An opt-in section SHALL only ever append: disabling one SHALL leave every section before it
byte-identical. That is what lets a channel be switched off without perturbing the policy the
copilot was already following.

#### Scenario: The skill loads the policy from the CLI

- **WHEN** the meeting-copilot skill starts a session
- **THEN** it runs `set-copilot prompt` with the session-scoped `SET_COPILOT_DIR` and treats the
  output as its policy

#### Scenario: Disabling narration does not perturb the alert policy

- **WHEN** the policy is rendered once with `copilot.narration.enabled` true and once with it false
- **THEN** the text up to and including the wall-input block is identical in both, and only the
  first contains the narration section

#### Scenario: Feedback can be turned off

- **WHEN** `copilot.acknowledge` is `false`
- **THEN** the policy contains no `## Feedback — liveness & wall echo` section

### Requirement: The alert taxonomy is data with defaults

The categories the copilot may speak up about SHALL come from `copilot.alerts`, each with a `key`,
an `emoji`, a `priority` (`high` | `medium` | `low`), an optional `label`, an optional `notify`,
and a `when` trigger. With no valid configured entry the shipped defaults SHALL apply:
⚠ `contradiction` (high, notify), 📋 `context` (medium), ✏ `new decision` (medium), ❓ `question`
(low). An entry missing a string `key`, `emoji` or `when` SHALL be dropped. The rendered block
SHALL list the categories highest priority first, label each with its `label` or else its key, in
upper case, render each `when` verbatim, and show the desktop-notification command only for the
categories with `notify` set (and no command at all when none has it). The output-format example
SHALL use the highest-priority category.

A project that only cares about one thing ships one category and gets a copilot that stays quiet
about everything else — without editing a skill.

#### Scenario: A project replaces the taxonomy

- **WHEN** `copilot.alerts` is `[{"key": "pricing", "emoji": "💰", "priority": "high", "when": "a price is quoted that differs from the price list"}]`
- **THEN** the alert block lists only `💰 **PRICING** (high priority)` with that trigger verbatim,
  and none of the shipped categories

#### Scenario: Categories are ordered by priority

- **WHEN** the configured categories are listed low, high, medium
- **THEN** the rendered block lists them high, medium, low

#### Scenario: Only notifying categories get the notify command

- **WHEN** the shipped defaults are used
- **THEN** the policy shows `set-copilot notify … --critical` for ⚠ CONTRADICTION only

### Requirement: Alerts are chat-only

The alert block SHALL state that an alert goes out as a chat line (plus the desktop notification
where configured) and never as a `wall-emit`; the wall carries narration, the mirror, visuals and
the pinned reference, not the alert taxonomy.

Since the shipped single-wall default, no wall box subscribes to the alert categories. Saying so in
the policy stops the copilot from emitting alert text at a wall that will not show it.

#### Scenario: The copilot is told where an alert goes

- **WHEN** the policy is rendered with any alert taxonomy
- **THEN** it contains the statement that alerts are chat-only and are never emitted with `wall-emit`

### Requirement: Engagement sets how much of a voice the copilot has

`copilot.engagement` SHALL select one of three contracts, and an absent or unknown value SHALL
resolve to `reactive`:

- `silent` — only `high` priority categories are spoken; everything else is silence, with no
  volunteering, elaborating or acknowledging.
- `reactive` — a watcher: speak when a category fires, otherwise end the turn with no visible text;
  greetings, scheduling, repetition and the copilot's own uncertainty all mean silence.
- `participant` — a third voice that may also confirm a supported claim, refute a contradicted one,
  add the fact being circled, or answer an open question, citing its source; it SHALL still be told
  that filler (acknowledgements, restating, hedging) is worse than silence.

A bug triage wants a watcher and a design call wants a participant; "how talkative" is a property
of the project, not of the package.

#### Scenario: The default is a watcher

- **WHEN** `copilot.engagement` is absent or set to `"chatty"`
- **THEN** the policy renders the `reactive` contract

#### Scenario: Participant licenses refuting, not filler

- **WHEN** `copilot.engagement` is `"participant"`
- **THEN** the policy tells the copilot it may confirm, refute, add and answer with a source, and
  states that "interesting point" or "I'm listening" is worse than silence

#### Scenario: Silent drops everything below high

- **WHEN** `copilot.engagement` is `"silent"`
- **THEN** the policy states that medium, low and uncategorised content is silence

### Requirement: Each contribution has a line budget

The policy SHALL state the maximum number of lines per contribution, taken from `copilot.maxLines`
when it is a positive number (floored to an integer) and `3` otherwise.

#### Scenario: A project raises the budget

- **WHEN** `copilot.maxLines` is `6.7`
- **THEN** the policy says to keep each contribution to at most 6 lines

#### Scenario: An invalid budget falls back

- **WHEN** `copilot.maxLines` is `0`
- **THEN** the policy says at most 3 lines

### Requirement: Web research is mentioned only when allowed

The policy SHALL permit background research (WebSearch / WebFetch) only when
`copilot.allowWebResearch` is exactly `true`, and then SHALL say to prefer a pause for it and to
name where the answer came from. Otherwise the policy SHALL NOT mention web research at all.

It costs seconds, and most meetings only need the project's own knowledge; a late answer to a topic
the room has left is noise.

#### Scenario: Research is off by default

- **WHEN** `copilot.allowWebResearch` is absent or `"yes"`
- **THEN** the policy contains no mention of WebSearch or WebFetch

#### Scenario: Research is allowed explicitly

- **WHEN** `copilot.allowWebResearch` is `true`
- **THEN** the policy permits WebSearch / WebFetch, prefers a `silence` window for it, and asks for
  the source to be named

### Requirement: The reaction goes out first

The policy SHALL always include a turn-order block that tells the copilot, when a poll returns lines
that fire a category: first emit the reaction alone; then batch everything else (narration, pinned
updates, drawings, staging, promotions) into one further emission; then return to listening at
once, chaining the next poll onto the same command when it drives the poll itself. It SHALL state
that when nothing fires there is no first step, and that the rule changes order only and never
licenses dropping content.

Measured on a real-time replay: a reaction reached the wall 39.4 s after its line — 14.5 s waiting
for the next poll and 24.9 s of model turn — while the poll itself returned in 2.5 s every time.
Each cycle held one emission composed after everything else had been decided, so the alert paid for
the narration's deliberation. Order is the only latency lever the policy has, and it is engine text
because it is about how a turn executes, not what a project considers worth saying.

#### Scenario: The rendered policy orders the turn

- **WHEN** the policy is rendered with any config
- **THEN** it contains `## Turn order — the reaction goes out first` with the three steps in order
  and the statement that it is an ordering rule, never a licence to drop content

### Requirement: Spoken commands are taught when the fast lane is on

When `copilot.fastLane.enabled` is not `false`, the policy SHALL describe the `{"type":"command"}`
event and its `{"type":"command-abandoned"}` counterpart, name the project's configured opening and
closing words, and state that: a command is an instruction to execute, ahead of everything in the
turn order including an alert, regardless of engagement; the copilot acts on the event and never on
the transcript line that still carries the words; and a partial (abandoned) command is never
executed — the copilot says in one chat line that it heard the opening and is waiting for the
closing word. When the lane is disabled or absent, the policy SHALL say nothing about it.

The transcript is a record and keeps the command's words; a copilot that treated both the event and
the line as work would carry one instruction out twice.

#### Scenario: The project's own markers are named

- **WHEN** `copilot.fastLane` declares `start: ["asszisztens"]` and `end: ["kész"]`
- **THEN** the fast-lane block names `asszisztens` and `kész`, not the shipped words

#### Scenario: A disabled lane leaves no phantom vocabulary

- **WHEN** `copilot.fastLane.enabled` is `false`
- **THEN** the policy contains no `## Spoken commands — the fast lane` section

### Requirement: The drawing contract block teaches the wall

When `copilot.drawing.enabled` is not `false` and `wall.categories` is non-empty, the policy SHALL
include a `## Drawing the wall` block that: tells the copilot to draw by spawning a fork with a
one-slot mandate and no model override (see `fork-producer`); lists every configured category id
with its icon and render type; gives the `wall-emit` command and the text, graph and chart payload
shapes with the `zone`, `priority`, `visual` and `op:"reset"` semantics; teaches the promotion
command and that a staged prediction must carry a `visual` id (see `predictive-staging`); states
the public-zone rule, including the `[belső]` marking convention and that a redaction failure
withholds rather than leaks (see `public-redaction`); and renders each `copilot.drawing.conventions`
entry verbatim under `**When to draw:**`. An explicitly empty conventions list SHALL omit the
"When to draw" part; an absent or non-list value SHALL fall back to the shipped conventions. With no
categories, or with drawing disabled, the block SHALL be omitted. A hand-built config with no
`wall` or `drawing` section SHALL render without the block rather than fail.

The categories come from `wall.categories`, the conventions from config; only the payload shapes
are hardcoded, because they are engine mechanics.

#### Scenario: A project's renamed categories flow through

- **WHEN** `wall.categories` declares `{"id": "diagram", "render": "graph"}` and no shipped ids
- **THEN** the block lists `` `diagram` `` rendering as **graph** and no shipped category id

#### Scenario: No conventions is honoured

- **WHEN** `copilot.drawing.conventions` is `[]`
- **THEN** the block is rendered without a `**When to draw:**` list

#### Scenario: Drawing disabled omits the block

- **WHEN** `copilot.drawing.enabled` is `false`
- **THEN** the policy contains no `## Drawing the wall` section

### Requirement: The project's own instructions are loaded verbatim

`copilot.instructions` SHALL name a project-owned markdown file, resolved against the project root,
whose trimmed content is appended verbatim under `## Project instructions` as the last section of
the policy. When the key is absent, no such section SHALL be rendered. When the key names a file
that does not exist, the policy SHALL carry a one-line notice naming the configured path instead of
the content, and rendering SHALL NOT fail.

Most projects never write one — the alert categories alone are a working policy — but a project
that did must find out its rules are missing from the policy, not from a copilot that ignores them.

#### Scenario: The instructions file is appended

- **WHEN** `copilot.instructions` is `docs/copilot.md` and that file exists
- **THEN** the policy ends with `## Project instructions` followed by the file's content

#### Scenario: A missing file is announced, not fatal

- **WHEN** `copilot.instructions` is `docs/missing.md` and no such file exists
- **THEN** `set-copilot prompt` succeeds and the policy contains a notice that
  `copilot.instructions points at docs/missing.md, which does not exist`
