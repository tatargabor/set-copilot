# Spec Delta

## IN SCOPE

- The live transcript page's speaker labels: a line's recorded `speakerName` outranks the
  serving machine's `transcript.speakers` map.

## OUT OF SCOPE

- The page's polling, cursor and route behaviour: only which label is attached changes.

## MODIFIED Requirements

### Requirement: The transcript page is opt-in by route

The transcript page SHALL be served only when `wall.transcriptPage.route` is a string starting
with `/`. With no route (the default) or an invalid one, neither the page at that route nor
`/api/transcript` SHALL be served: both SHALL answer 404. The page title SHALL come from
`wall.transcriptPage.title` (non-blank, trimmed; default `Live transcript`), and speaker labels
SHALL come from the line's recorded `speakerName` when it carries one — the same rule the
stitched transcript follows — falling back to `transcript.speakers` and then the raw speaker
tag.

#### Scenario: No route, no endpoint

- **WHEN** `wall.transcriptPage.route` is not configured and a client requests
  `/api/transcript`
- **THEN** the server answers 404

#### Scenario: A configured route serves the page

- **WHEN** `wall.transcriptPage.route` is `"/transcript"` and `transcript.speakers` maps `mic`
  to `Us`
- **THEN** `/transcript` serves the transcript page and a `mic` line arrives labelled `Us`

#### Scenario: A recorded label outranks the serving machine's map

- **WHEN** a mic line carries `"speakerName": "gazda"` and the serving machine's
  `transcript.speakers` maps `mic` to `Us`
- **THEN** that line arrives on the page labelled `gazda`
