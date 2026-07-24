# box-policy Specification

## Purpose
How the copilot's content mandate is scoped to an individual box — the instructions, alert
categories, engagement level, and drawing conventions that govern what a box emits — layered over
the session-global `copilot.*` policy and rendered as one section per box by `set-copilot prompt`.
A box's mandate is independent of the window-level zone that routes where its events may appear.
## Requirements
### Requirement: Policy is scopable to a box

Content policy — the instructions, the alert categories, the engagement level, and the drawing
conventions that govern what the copilot produces — SHALL be scopable to an individual box, in
addition to the existing session-global scope.

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

### Requirement: A box's mandate is independent of its zone

A box's *mandate* (what it is for, what is worth emitting to it) SHALL be a property of the box
(`WallBox.policy`), independent of *zone*. Zone is a property of the *window* (`WallWindow.zones`),
not of the box: it governs where a window's events may appear. The shipped default expresses this
through the private hint box: it checks what the speaker says against known information and surfaces
what they may not know — contradictions, relevant context, decisions worth recording.

Zone routing SHALL remain the mechanism that decides *where* an event may appear; box policy decides
*what is worth emitting* for that box. The two SHALL be independent: changing the zone of the window
a box lives in SHALL NOT change the box's mandate, and changing a box's mandate SHALL NOT change any
zone.

> A public *narration* box — the private box's counterpart, rendering the conversation for an
> audience — was specified here originally. It moved to `wall-public-redaction`: a narration box is
> only safe once the public zone is redacted, and that capability was deferred after an adversarial
> pass found the redactor leaky. The independence requirement below is what that future box will
> rely on.

#### Scenario: Zone and mandate are independent

- **WHEN** the zone of the window a box lives in is changed from `private` to `public` with the
  box's policy left untouched
- **THEN** the box's mandate is unchanged and only its routing changes

#### Scenario: The private box's mandate is carried by policy, not by its zone

- **WHEN** the private hint box is defined with an instruction to check and surface, inside a window
  zoned `private`
- **THEN** its instruction governs what it emits, and the window's zone governs only which display
  clients receive it

### Requirement: The prompt renderer composes one section per box

`set-copilot prompt` SHALL render the policy as one section per box, each naming the box, its
zone, its render surface, and its effective mandate — so a session reading the prompt knows what
each box is for without inspecting config.

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

