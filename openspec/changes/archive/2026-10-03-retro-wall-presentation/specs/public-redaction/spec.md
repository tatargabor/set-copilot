# Spec Delta

## ADDED Requirements

### Requirement: The transcript page is a public surface redacted by the same taxonomy

The live transcript page (`wall-transcript-page`) SHALL be treated as a public surface: every line
it serves SHALL be run through the wall's redaction taxonomy (`wall.redaction`) before it leaves
the server, unless the page is explicitly configured with `wall.transcriptPage.redact: false`.
Only that explicit `false` SHALL turn redaction off; an absent, malformed or any other value
SHALL keep it on.

The page SHALL fail closed: when redaction of a line throws — a leaf longer than the redaction
input cap, a pattern error — or when a pattern still matches the scrubbed text, the line's text
SHALL be replaced in full by the configured replacement marker rather than served. The line's
speaker and time MAY still be shown, so the reader sees that something was said and withheld.

This surface is NOT part of the shared ingest funnel and NOT part of the window audience model:
transcript lines are read straight from the capture's file per request, never ingested as display
events, and the page has no `audience` declaration. Its protection is exactly the `redact`
setting; a window's `audience` or `zones` do not affect it.

#### Scenario: A marked term is scrubbed on the transcript page

- **WHEN** the redaction taxonomy matches `40 man-days` and a transcript line reads
  `that is 40 man-days`
- **THEN** the page receives `that is [internal]` (the configured replacement), not the original

#### Scenario: Redaction off is an explicit decision

- **WHEN** `wall.transcriptPage.redact` is `false`
- **THEN** the page receives the line unredacted; with the key absent or set to any other value,
  it receives the redacted line

#### Scenario: An over-long line is withheld, not passed through

- **WHEN** a transcript line is longer than the redaction input cap
- **THEN** its text is served as the replacement marker alone, with none of the original text
