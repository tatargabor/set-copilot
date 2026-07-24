## ADDED Requirements

### Requirement: A public narration box narrates processed output

Once the public zone is redacted, the default `/wall` MAY carry a narration box: the private hint box's
counterpart, rendering the conversation for an audience. Its mandate SHALL be to narrate what the
speaker says — but what it emits SHALL be *processed* output (filtered and condensed), never a raw
transcript. This preserves the `src/config.ts` invariant that the wall shows only processed output:
narration is a summary that has passed redaction, not the transcript verbatim.

The narration box SHALL rely on the `public-redaction` capability for its safety: it SHALL NOT be
enabled in a default config until redaction is present and adversarially verified. It builds on the
existing box-policy requirement that a box's mandate is independent of its zone — the narration box is
a `public`/`both`-zone box whose mandate is narration.

#### Scenario: The narration box emits processed, redacted output

- **WHEN** the speaker says something that touches internal information, and the narration box is active
- **THEN** what appears on the public wall is a condensed narration with the internal information
  redacted or the event withheld — never the raw transcript line

#### Scenario: The narration box is absent until redaction lands

- **WHEN** the `public-redaction` capability is not present in the running build
- **THEN** the default config ships no public narration box, and the `/wall` shows only graphs and
  charts a producer deliberately draws there
