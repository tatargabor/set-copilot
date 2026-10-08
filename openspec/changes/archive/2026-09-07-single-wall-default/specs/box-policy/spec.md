## MODIFIED Requirements

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
