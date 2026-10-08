# wall-input Specification

## Purpose
The wall→session input path: a human at the wall hands the Claude session a short
instruction, which arrives as an event in the session's poll stream — the same seam a
replay harness can drive.

## Requirements

### Requirement: The wall page can send a short message to the session

The wall page SHALL offer a small input in its status strip (present in every layout):
typing a line and submitting it SHALL POST the text to the wall server, and the page SHALL
confirm the outcome to the viewer without fabricating any display event. The input SHALL
NOT take focus automatically — the page is a shared screen.

#### Scenario: A message sent from the wall is confirmed locally

- **WHEN** the operator types a line into the strip input and submits it, and the server
  accepts it
- **THEN** the page shows a transient confirmation on the strip, and no display event is
  added to the wall's content streams

#### Scenario: A failed send says so

- **WHEN** the server rejects or cannot be reached
- **THEN** the page shows a transient failure indication instead of a confirmation

### Requirement: The server validates and appends the input as one JSONL line

The wall server SHALL accept `POST /api/input` with a JSON body carrying the text; every
other method on the route SHALL be refused. The body SHALL be size-capped, the text SHALL
be trimmed, SHALL NOT be empty, SHALL NOT exceed 400 characters, and SHALL NOT contain
control characters (including newlines and tabs — one input is one JSONL line); accented
text and emoji SHALL pass. A valid input SHALL be appended to `<runtimeDir>/wall-input.jsonl`
as a single JSON object carrying at least the reception time and the text, and SHALL NOT be
broadcast to wall clients or written to `wall-events.jsonl`. Without a runtime dir the
endpoint SHALL refuse rather than drop the input silently.

#### Scenario: A valid line lands in the input file

- **WHEN** a POST carries `"rajzold újra a gráfot"` and the wall owns a runtime dir
- **THEN** the file gains exactly one JSON line containing that text, and no wall client
  receives anything

#### Scenario: Malformed input is refused with a reason

- **WHEN** a POST carries an empty text, more than 400 characters after trimming, or a
  newline inside the text
- **THEN** the server answers 400 without appending anything

#### Scenario: An oversized body never reaches validation

- **WHEN** a POST body exceeds the server's byte cap
- **THEN** the server answers 413 without parsing or appending

#### Scenario: Other methods are refused

- **WHEN** a GET hits `/api/input`
- **THEN** the server answers 405 without appending

### Requirement: The session's poll hands wall input over at command priority

The poll SHALL tail `wall-input.jsonl` with its own line-count offset (`wall-input-offset`)
and, for each new valid line, emit `{"type":"wall-input","text":…}` — checked BEFORE the
capture-dead verdict, so a pending input is handed over even when the capture is gone, and
returning immediately rather than waiting behind the silence gate or the dwell bound, the
same priority a spoken command gets. Blank or malformed input lines SHALL be skipped without
advancing the offset past valid content. The poll SHALL NOT mix wall input into the
transcript's echo-dedup: a repeated input is a repeated instruction, not an echo.

#### Scenario: An input returns at the next tick

- **WHEN** a line lands in `wall-input.jsonl` while the poll is mid-wait
- **THEN** the poll returns at its next tick, emits the wall-input event, and advances only
  the wall-input offset — transcript lines remain pending for the next poll

#### Scenario: An input is drained before the capture is reported dead

- **WHEN** the capture is gone and the input file holds an unread line
- **THEN** the poll hands the input over first and reports the dead capture only when
  nothing is left

#### Scenario: A repeated instruction is delivered twice

- **WHEN** the operator sends the same text twice
- **THEN** the session receives two wall-input events — the transcript's echo-dedup never
  applies to operator input

### Requirement: The input offset cannot outlive its file silently

Starting the wall SHALL rotate a non-empty `wall-input.jsonl` aside (renamed, never
truncated) and reset `wall-input-offset` to the file's start, so an offset left over from a
previous meeting cannot silently suppress every message typed into the next one.

#### Scenario: A wall restart does not swallow new input

- **WHEN** a previous session's wall left an input file and offset behind, and a new wall
  starts in the same runtime dir
- **THEN** the old input file is rotated aside, the offset resets, and the first new input
  is delivered
