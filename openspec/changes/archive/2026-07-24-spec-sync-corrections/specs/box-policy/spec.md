## MODIFIED Requirements

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
