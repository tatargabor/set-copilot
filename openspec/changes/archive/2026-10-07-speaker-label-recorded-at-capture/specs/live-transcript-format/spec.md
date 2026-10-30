# Spec Delta

## IN SCOPE

- The `speakerName` field on speech lines, stamped by the capture from the capturing machine's
  resolved `transcript.speakers.*`.

## OUT OF SCOPE

- Attributing the non-speech events (`silence`, `reconnect`) or the fast-lane
  `command`/`command-abandoned` events: they are not quoted speech, and nothing renders them
  under a name.
- Any change to the `speaker` channel field or to what the config keys mean.

## ADDED Requirements

### Requirement: A line records who the capturing machine says spoke

A speech line SHALL carry `speakerName`, the display label the capturing machine resolved for
that line's channel from its `transcript.speakers.mic` / `transcript.speakers.system` — the fact
of who sat at this machine's microphone exists at capture time and nowhere else, so it is
recorded then. The value SHALL be written when the machine's config resolves a non-empty label
for the channel and SHALL be absent when it does not, so an unconfigured machine's recordings
are byte-shape-compatible with today's. The `speaker` channel field SHALL continue to carry the
channel (`"mic"` / `"system"`), and no other event in the stream (a `silence` period, a
`reconnect`, a fast-lane verdict) SHALL carry a `speakerName`, because none of them is quoted
speech.

#### Scenario: The mic label is stamped at capture time

- **WHEN** the capturing machine's config resolves `transcript.speakers.mic` to `"gazda"` and a
  mic line is flushed
- **THEN** the line carries `"speaker": "mic"` and `"speakerName": "gazda"`

#### Scenario: The system label is stamped from the project's config

- **WHEN** the config resolves `transcript.speakers.system` to `"vendég"` and a system
  line is flushed
- **THEN** the line carries `"speakerName": "vendég"`

#### Scenario: An unlabelled channel writes no field

- **WHEN** no label is configured for the channel and a line is flushed
- **THEN** the line carries no `speakerName` field at all — not an empty one
