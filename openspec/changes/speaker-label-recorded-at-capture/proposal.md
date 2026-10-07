# Proposal

## Why

Who spoke is attributed at STITCH time today: each line carries only the channel
(`speaker: "mic" | "system"`), and the stitch maps channel → name through the stitching machine's
`transcript.speakers.*` config. A recording is a file that moves — `stop` archives it, back-fill
copies it between repos, a teammate stitches it on another machine — and on a different machine
the same file renders with DIFFERENT names: the capturing machine's `transcript.speakers.mic` is
a machine-local key (`machine-local-audio-and-speaker`), so machine B's stitch re-attributes
machine A's voice to whoever machine B's config says sits at the microphone. A meeting note that
names the wrong person as having said a decision is worse than one that names nobody.

The fact "who was at this machine's microphone" exists only at capture time. So it must be
written into the recording then, and the stitch must treat it as the authority.

## What Changes

- The capture stamps every speech line with `speakerName`, the resolved label for its channel
  (`transcript.speakers.mic` / `transcript.speakers.system`, as resolved on the capturing
  machine). Lines without a configured label carry no field, exactly as today.
- The stitch prefers a line's recorded `speakerName` over the stitching machine's
  `transcript.speakers.*` map; the map stays the fallback for recordings that predate the field.
  Nothing downstream may re-attribute a recorded label.
- The fast-lane `command`/`command-abandoned` events and the `silence`/`reconnect` events are not
  attributed speech — they carry no `speakerName`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `live-transcript-format`: new requirement — a speech line records who the capturing machine
  says spoke.
- `transcript-stitch`: new requirement — a recorded speaker label outranks the stitching
  machine's config; old recordings keep today's channel→config mapping.

## Impact

- `src/transcript-writer.ts`: `TranscriptWriterOptions.speakerNames`, stamped in `writeLine`.
- `src/capture.ts`: pass `cfg.transcript.speakers` to the writer.
- `src/transcript-build.ts`: `parseTranscript` reads `speakerName` and resolves the line's
  speaker to it when present; everything downstream (channel rebuild, sentence speaker, the
  `who` lookup at `transcript-build.ts:513`) renders the recorded label through the existing
  `opts.speakers[x] ?? x` fallback.
- Tests: `src/transcript-writer.test.ts`, `src/transcript-build.test.ts`, and a
  capture-path check via the CLI for the wiring (`capture.ts` has no unit test — audio/PID
  paths are verified by running, per CLAUDE.md; here the wiring is covered by a config→writer
  unit case plus `set-copilot transcript` on a real capture-shaped file).
- No skill or config change: the key exists; only who wins changes.
