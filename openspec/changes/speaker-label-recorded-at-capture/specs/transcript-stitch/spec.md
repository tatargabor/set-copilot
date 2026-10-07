# Spec Delta

## IN SCOPE

- The stitch's speaker attribution: a recorded `speakerName` outranks the stitching machine's
  `transcript.speakers.*` map, in the readable and the structured artifacts alike.
- The base requirement's configuration scenario, narrowed to recordings without a recorded
  label.

## OUT OF SCOPE

- The channel rebuild, the sentence splitting, and the ordering: attribution changes only which
  name is attached, never which lines are grouped — the channel stays the internal grouping key,
  so attribution cannot merge or split channels.
- The `--speakers` CLI override's existence and parsing; it becomes the fallback for recordings
  without a recorded label.

## MODIFIED Requirements

### Requirement: The stitch emits a readable and a structured artifact

Each stitch SHALL produce both a Markdown transcript for human and LLM readers — timestamped,
speaker-labelled turns — and a sentence-level JSONL for machine consumers, so a tool never has
to parse Markdown. Each structured line SHALL carry at least the sentence text, its speaker, its
start and end timestamps, and whether it overlapped the other channel. The `speaker` each
artifact carries SHALL be resolved by the recorded-label rule of "A recorded speaker label
outranks the stitching machine's config", identically in both artifacts.

#### Scenario: Both artifacts are written

- **WHEN** a stitch runs over a non-empty transcript
- **THEN** a `.md` and a sentence-level `.jsonl` are written, containing the same sentences
  in the same order

#### Scenario: Speaker labels come from configuration

- **WHEN** `transcript.speakers` maps `mic` and `system` to display names and the lines carry
  no recorded `speakerName`
- **THEN** the Markdown uses those names, and an unmapped channel falls back to its raw
  channel name

#### Scenario: The two artifacts attribute identically

- **WHEN** a stitch runs over a recording whose mic lines carry a recorded `speakerName`
- **THEN** the Markdown turn labels and the structured lines' `speaker` field carry the same
  recorded label

## ADDED Requirements

### Requirement: A recorded speaker label outranks the stitching machine's config

When a line carries a recorded `speakerName`, the stitch SHALL attribute the sentence to that
recorded label — in the readable transcript, the structured transcript, and every other
rendering of the sentence stream — and SHALL NOT replace it with the name the stitching
machine's `transcript.speakers.*` config resolves, not even when the config has an entry keyed
by the label itself or an explicit `--speakers` override names it: the label was written by the
machine that heard the voice, and every later machine's config answers a different microphone.
A line without a recorded `speakerName` SHALL keep today's behaviour: the stitching machine's
config maps the channel, falling back to the raw channel name. The label SHALL ride beside the
channel, not replace it: grouping, overlap marking and rotation repair SHALL continue to work
on the channel, so a degenerate config that resolves both channels to one label degrades
cosmetically (one name rendered twice) and never merges the channels' rebuild.

#### Scenario: A recorded label wins over the stitching machine's config

- **WHEN** a recording's mic lines carry `"speakerName": "gazda"` and the stitching machine's
  config maps `mic` to `"más"`
- **THEN** the sentence is attributed to `gazda`, in the readable and the structured artifacts

#### Scenario: A recording without the field keeps today's behaviour

- **WHEN** a pre-field recording's mic lines carry only `"speaker": "mic"` and the stitching
  machine's config maps `mic` to `"más"`
- **THEN** the sentence is attributed to `más`, exactly as before

#### Scenario: The recorded label is not fed back through the map

- **WHEN** a line carries `"speakerName": "gazda"` and the config — or an explicit `--speakers`
  override — maps `gazda` to some other string
- **THEN** the sentence is attributed to `gazda` — the recorded label is terminal

#### Scenario: Equal labels do not merge the channels

- **WHEN** a recording's mic and system lines both carry the same recorded `speakerName`, and
  the two channels' speech overlaps
- **THEN** the sentences remain distinct per channel with their overlap marked, and both render
  under the shared label
