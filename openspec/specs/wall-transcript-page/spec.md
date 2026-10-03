# wall-transcript-page Specification

## Purpose
Serve a plain, live page showing what was said and by whom as the capture transcribes it — no
copilot in between — for a screen-shared call or a second monitor. The page polls the wall
server over an idempotent byte-offset cursor, so a reload, a sleeping laptop or a dropped
connection recovers by simply asking again.

## Requirements
### Requirement: The transcript page is opt-in by route

The transcript page SHALL be served only when `wall.transcriptPage.route` is a string starting
with `/`. With no route (the default) or an invalid one, neither the page at that route nor
`/api/transcript` SHALL be served: both SHALL answer 404. The page title SHALL come from
`wall.transcriptPage.title` (non-blank, trimmed; default `Live transcript`), and speaker labels
SHALL come from `transcript.speakers` — the same map the stitched transcript uses — falling back
to the raw speaker tag.

#### Scenario: No route, no endpoint

- **WHEN** `wall.transcriptPage.route` is not configured and a client requests
  `/api/transcript`
- **THEN** the server answers 404

#### Scenario: A configured route serves the page

- **WHEN** `wall.transcriptPage.route` is `"/transcript"` and `transcript.speakers` maps `mic`
  to `Us`
- **THEN** `/transcript` serves the transcript page and a `mic` line arrives labelled `Us`

### Requirement: Lines are read by byte offset from the file the capture is writing

`GET /api/transcript?offset=<n>&id=<id>` SHALL return the lines appended to the active transcript
since byte `offset`, with the next offset, the file `id`, the page title, the wall's
presentation theme and the configured reading order. The active transcript SHALL be the file
named by the running capture's `capture.output` marker in the runtime dir, else the configured
transcript path; when there is none, the response SHALL carry `id: null` and no lines, and the
page SHALL say it is waiting for the capture.

The `id` SHALL identify the file by path and inode. When the request's `id` differs from the
current file's, or the offset is not a finite number, is negative, or lies beyond the file's
end, the server SHALL read from the start, and the page SHALL discard what it showed and start
over — so a cursor never reads a stale position into a different file.

Only complete lines SHALL be returned: a trailing line without its newline is still being
written and SHALL be left for the next poll, and the returned offset SHALL point just past the
last complete line. A line whose JSON does not parse, has no `text`, or carries `final: false`
SHALL be skipped. Each returned line SHALL carry its `ts`, `speaker`, label, text, and `cont` /
`midWord` flags.

On a first read (offset 0) of a file larger than 1 MB, the server SHALL start 1 MB from the end
and drop the first, partial line; a single poll SHALL read at most 2 MB.

#### Scenario: The cursor advances

- **WHEN** a page polls with the offset returned by its previous poll and one new line has been
  appended
- **THEN** the response contains exactly that line and a larger offset

#### Scenario: A half-written line is held back

- **WHEN** the transcript ends with a line that has no trailing newline yet
- **THEN** that line is not returned, and it is returned by the poll after its newline is
  written

#### Scenario: A new capture file resets the page

- **WHEN** a poll carries the `id` of the previous capture's file
- **THEN** the server reads the new file from its start and the page clears and re-renders
  from it

#### Scenario: A long meeting's first read is bounded

- **WHEN** a page opens on a 30 MB transcript
- **THEN** its first poll returns only lines from the last 1 MB, beginning at the first complete
  line in that window

### Requirement: The page groups fragments into turns and follows the live edge

The page SHALL poll about once a second and group fragments into turns: a new turn SHALL begin
when the speaker changes, or when more than 12 seconds passed since that turn's last fragment and
the new fragment is not a `cont` continuation. Each turn SHALL show the speaker label, a colour
per speaker with a legend, and the turn's start time. Within a turn, a `midWord` fragment SHALL
join without a space, a fragment starting with closing punctuation SHALL join without a space,
and any other fragment SHALL join with one space.

The page SHALL follow the live edge — the bottom in `oldest-first` order (the default), the top
in `newest-first` order — unless the reader scrolls away from it; a `Live` button SHALL then
return to the edge and resume following. `wall.transcriptPage.order` SHALL accept
`"newest-first"`, any other value meaning `"oldest-first"`; when the order the server reports
changes, the page SHALL rebuild from the start. The text size SHALL be adjustable (A−/A+) and
remembered per viewer. A failed poll SHALL show a reconnecting status and retry.

#### Scenario: A pause starts a new turn

- **WHEN** the same speaker produces a non-continuation fragment 15 seconds after their previous
  one
- **THEN** it opens a new turn with its own label and time

#### Scenario: A mid-word cut is rejoined

- **WHEN** a fragment ending `speci` is followed in the same turn by a `midWord` fragment
  `fikáció`
- **THEN** the page shows `specifikáció` with no space inside the word

#### Scenario: Newest first for a glance at a shared screen

- **WHEN** `wall.transcriptPage.order` is `"newest-first"`
- **THEN** the latest turn is at the top of the page and the page follows the top

#### Scenario: Scrolling away stops following

- **WHEN** a reader scrolls back into earlier turns while new lines arrive
- **THEN** the view stays where the reader is and a `Live` button appears; pressing it returns
  to the live edge

### Requirement: The page is bounded and inserts text as text only

The page SHALL keep at most 5000 fragments in the document; beyond that it SHALL drop the oldest
turns, never the turn currently being written. Every transcript-derived string — text, speaker
label — SHALL be inserted as plain text, never as markup, because a transcript is untrusted
input. The page SHALL follow the wall's theme as reported by the server (`studio-dark` gets the
matching palette; otherwise the OS light/dark preference applies).

#### Scenario: Markup in speech stays text

- **WHEN** a transcript line's text is `<img src=x onerror=alert(1)>`
- **THEN** the page shows those characters literally and no element is created from them

#### Scenario: A page left open for days stays bounded

- **WHEN** more than 5000 fragments have arrived
- **THEN** the oldest turns are removed until the count is within budget, and the current turn
  is kept
