# Spec Delta

## IN SCOPE

- The stitch's speaker attribution: a recorded `speakerName` outranks the stitching machine's
  `transcript.speakers.*` map, in the readable and the structured artifacts alike.

## OUT OF SCOPE

- The channel rebuild, the sentence splitting, and the ordering: attribution changes only which
  name is attached, never which lines are grouped — a recording's lines carry exactly two
  channels and the label is constant per channel.
- The `--speaker mic=Név` CLI override's existence and parsing; it becomes the fallback for
  recordings without a recorded label.

## ADDED Requirements

### Requirement: A recorded speaker label outranks the stitching machine's config

When a line carries a recorded `speakerName`, the stitch SHALL attribute the sentence to that
recorded label — in the readable transcript, the structured transcript, and every other
rendering of the sentence stream — and SHALL NOT replace it with the name the stitching
machine's `transcript.speakers.*` config resolves for the line's channel: the label was written
by the machine that heard the voice, and the stitching machine's config answers a different
microphone. A line without a recorded `speakerName` SHALL keep today's behaviour: the
stitching machine's config maps the channel, falling back to the raw channel name. The recorded
label SHALL NOT feed back into the config mapping — a line labelled `gazda` on a machine whose
config maps `mic` to another label SHALL render `gazda`, not the config's name, and not
`config's name` attributed through the label.

#### Scenario: A recorded label wins over the stitching machine's config

- **WHEN** a recording's mic lines carry `"speakerName": "gazda"` and the stitching machine's
  config maps `mic` to `"más"`
- **THEN** the sentence is attributed to `gazda`, in the readable and the structured artifacts

#### Scenario: A recording without the field keeps today's behaviour

- **WHEN** a pre-field recording's mic lines carry only `"speaker": "mic"` and the stitching
  machine's config maps `mic` to `"más"`
- **THEN** the sentence is attributed to `más`, exactly as before

#### Scenario: The recorded label is not fed back through the map

- **WHEN** a line carries `"speakerName": "gazda"` and the config maps `gazda` to some other
  string
- **THEN** the sentence is attributed to `gazda` — the recorded label is terminal
