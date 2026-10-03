# box-policy Specification

## Purpose
How the copilot's content mandate is scoped to an individual box — the instructions, alert
categories, engagement level, and line budget that govern what a box emits — layered over
the session-global `copilot.*` policy and rendered as one section per box by `set-copilot prompt`.
A box's mandate is independent of the window-level zone that routes where its events may appear.

## Requirements

### Requirement: Policy is scopable to a box

Content policy — the instructions, the alert categories, the engagement level, and the per-emission
line budget (`maxLines`) that govern what the copilot produces for a surface — SHALL be scopable to
an individual box, in addition to the existing session-global scope. The drawing contract
(`copilot.drawing`: the category summary, payload shapes, render types and drawing conventions) is
session-global and SHALL NOT be overridden per box.

A box's effective policy SHALL be the session-global policy overridden key by key with that box's
own declarations. A box that declares no policy SHALL inherit the global one unchanged, so an
existing single-policy configuration keeps working with no edit.

Policy SHALL remain config, never code: adding, reweighting, or rewording a box's mandate SHALL
NOT require editing `src/` or a skill.

#### Scenario: A box overrides only what it declares

- **WHEN** the session-global policy sets `engagement: "reactive"` and a set of alert categories,
  and a box declares only its own `instructions`
- **THEN** that box's effective policy uses its own instructions with the global engagement and
  the global alert categories

#### Scenario: A configuration with no box policy is unchanged

- **WHEN** a config declares only session-global `copilot.*` policy and no box-scoped policy
- **THEN** every box inherits the global policy and behaves exactly as before this change

#### Scenario: The drawing contract is not box-scoped

- **WHEN** a project changes its drawing conventions
- **THEN** it does so in `copilot.drawing`, and the change applies to every box

### Requirement: A box's mandate is independent of its zone

A box's *mandate* (what it is for, what is worth emitting to it) SHALL be a property of the
box (`WallBox.policy`), independent of *zone*. Zone is a property of the *window*
(`WallWindow.zones`), not of the box: it governs where a window's events may appear. The
shipped default expresses this through the wall's narration box: its policy says what is
worth emitting for an audience — summarize, never raw transcript, mark internal content —
while the window's `zones` decide where those events may appear.

Zone routing SHALL remain the mechanism that decides *where* an event may appear; box
policy decides *what is worth emitting* for that box. The two SHALL be independent: changing
the zone of the window a box lives in SHALL NOT change the box's mandate, and changing a
box's mandate SHALL NOT change any zone.

> A public *narration* box was specified here originally and moved to
> `wall-public-redaction` once the redactor was hardened; with a single shipped wall it is
> the default surface's text box. A private hint box (check-and-surface) remains reachable
> by config for projects that declare a private window — as policy plus zone, never as one
> implying the other.

#### Scenario: Zone and mandate are independent

- **WHEN** the zone of the window a box lives in is changed from `private` to `public` with the
  box's policy left untouched
- **THEN** the box's mandate is unchanged and only its routing changes

#### Scenario: The private box's mandate is carried by policy, not by its zone

- **WHEN** a private hint box is defined with an instruction to check and surface, inside a
  project-declared window zoned `private`
- **THEN** its instruction governs what it emits, and the window's zone governs only which
  display clients receive it

#### Scenario: The wall's narration box carries an audience-facing mandate

- **WHEN** the shipped wall's narration box is defined with an audience-facing instruction,
  inside the public-audience window
- **THEN** its instruction governs what it emits, and the window's zone governs only which
  display clients receive it

### Requirement: The prompt renderer composes one section per box

`set-copilot prompt` SHALL render, in addition to the global policy, one section for every box that
declares its own policy, each naming the window and box position, the window's zones, the box's
categories with their render types, and **only the keys the box overrides** — stating that
everything else is inherited from the global policy. Restating inherited values would invite the
two to drift; a session reading the prompt still knows what each box is for without inspecting
config.

Where no box declares its own policy, the renderer SHALL emit the single global section as it does
today, so the output stays compact for the common case.

#### Scenario: Per-box sections are rendered

- **WHEN** a config declares two boxes with distinct policies (for example a checking box and a
  differently-mandated one)
- **THEN** `set-copilot prompt` emits a section for each, and a reader can tell from the output
  alone which mandate governs which box

#### Scenario: A single-policy config renders a single section

- **WHEN** no box declares its own policy
- **THEN** `set-copilot prompt` emits one global policy section, unchanged from today's output

#### Scenario: Only overridden keys are printed

- **WHEN** a box declares only `instructions` and `maxLines`
- **THEN** its section prints those two and states that the rest is inherited, without restating
  the global engagement or alert categories

### Requirement: A public narration box narrates processed output

The shipped `/wall` window SHALL carry a narration box (`szöveg`, a scrolling text box subscribed
to the narration and chat-mirror categories) whose policy mandates condensed, audience-safe
output: narrate what the speaker says, never the raw transcript, and mark internal detail
`[belső]` (which the server redacts) or leave it out. What it emits SHALL be *processed* output
(filtered and condensed), never a raw transcript. This preserves the invariant that the wall's
event stream shows only processed output: narration is a summary that has passed redaction, not
the transcript verbatim.

The narration box SHALL rely on the `public-redaction` capability for its safety — the ingest
funnel's redactor, not the producer's care, is what keeps internal detail off the wall. The box's
mandate is independent of its window's zones, per the requirement above.

#### Scenario: The narration box emits processed, redacted output

- **WHEN** the speaker says something that touches internal information, and the narration box is active
- **THEN** what appears on the public wall is a condensed narration with the internal information
  redacted or the event withheld — never the raw transcript line

#### Scenario: The narration box is absent until redaction lands

- **WHEN** the default config is loaded
- **THEN** the `/wall` window carries the narration box only together with an active public-zone
  redaction taxonomy that matches the `[belső]`/`[internal]` marking its policy teaches — the
  narration box never ships without the redactor it relies on

### Requirement: Box policy is never served to wall clients

A box's policy is copilot instruction, and may name internal matters. The window definition the
server hands a wall client SHALL omit every box's `policy`, whatever the window's audience.

#### Scenario: The bootstrap carries boxes without their policy

- **WHEN** a wall client fetches its window definition and a box in that window declares a policy
- **THEN** the definition carries the box's position, categories and behaviour, and no `policy`
