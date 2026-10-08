## REMOVED Requirements

### Requirement: Narration is private by default

**Reason:** The shipped default no longer has a private view to be private *to* — one
public wall is the whole surface. The rule's protective intent (narration must never reach
an audience unredacted) is carried forward by the replacement requirement together with
`public-redaction`: safety now comes from the ingest-funnel redactor, not from nobody
looking.

**Migration:** Emit narration `zone:"both"`. The producer marks internal content `[belső]`
or drops it; the server redacts at ingest exactly as it does for every other payload
reaching a public client.

## ADDED Requirements

### Requirement: Narration is a redaction-backed lane on the wall

Narration SHALL be emitted to the wall's zone-shared lane (`zone:"both"`) and SHALL reach
the single wall only as the public-redaction funnel renders it safe: the server SHALL
redact narration at ingest before broadcast or accumulation, and the producer SHALL mark
internal content `[belső]` or omit it, never forwarding the raw transcript. Narration's
cadence, verbosity, and no-filler rules SHALL be unchanged by this routing.

A private view, where a project configures one, MAY additionally receive narration via
`zone:"private"` emissions; its presence SHALL NOT be required for the wall lane to
function.

#### Scenario: Narration reaches the wall redaction-backed

- **WHEN** the copilot narrates and the wall (a public-audience client) is connected
- **THEN** the narration line arrives through the ingest-funnel redactor — internal
  segments are scrubbed or withheld, and the line renders in the wall's narration box

#### Scenario: Internal narration content is marked or dropped at the source

- **WHEN** the narration line would carry internal detail (a contradiction citing private
  material, a named client)
- **THEN** the producer marks it `[belső]` or drops the line, and the redactor's
  marker-based pattern catches what was marked
