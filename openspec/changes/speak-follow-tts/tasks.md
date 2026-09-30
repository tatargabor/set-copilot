## 1. Config seam

- [ ] 1.1 Add a `SpeechConfig` interface and a `speech` section to `src/config.ts`: `enabled`
  (default false), `engine` ("google" default, "say" fallback), `voice`
  (`hu-HU-Chirp3-HD-Achernar`), `languageCode`, `rate`, `deadlineMs`, `maxLength` (the spoken
  ceiling — **150**, from the measured ~12.4 chars/sec ≈ 12 s), `minLength` (the floor below which
  nothing is spoken, ~25), and `leadMarker` (the spoken-lead prefix).
- [ ] 1.2 Add the `speech` defaults to `DEFAULTS` and resolve the section key-by-key in the config
  resolver, matching how the other nested sections merge — `audio`'s omission from that merge is a
  bug this repo has already paid for once.
- [ ] 1.3 Extend `src/config.test.ts`: defaults present, per-key merge across user/project config,
  an explicitly empty/zero value honoured rather than silently replaced by the default.

## 2. Selection policy (pure)

- [ ] 2.1 Create `src/speak-policy.ts` with `applySpeakPolicy(raw, cfg): SpeakVerdict` — a closed
  decision vocabulary (`speak` | `short` | `empty`) plus the text and which tier produced it.
- [ ] 2.2 Tier 1: detect the configured lead marker anchored at the message start and return that
  line as the spoken text.
- [ ] 2.3 Tier 2: mechanical extraction — strip fenced code blocks, tables and box-drawing blocks,
  file paths and URLs; then take leading sentences up to `maxLength`, truncating on the last
  sentence boundary within the ceiling. Unicode word boundaries (`\p{L}\p{N}`), never `\b`.
- [ ] 2.4 Return `empty` when extraction yields nothing and `short` when it is below `minLength`, so
  the log can name which rule suppressed the message.
- [ ] 2.5 Write `src/speak-policy.test.ts` covering: a marked lead wins over the body; an unmarked
  technical answer reduces to a speakable sentence; a code-only message yields `empty`; truncation
  lands on a sentence boundary and never emits a second chunk; Hungarian and English input.

## 3. Engine seam

- [ ] 3.1 Create `src/speak-engine.ts`: a `SpeechEngine` interface (`speak(text): Promise<void>`,
  `stop(): void`, `available(): boolean`, `kind: "local" | "remote"`) and `resolveEngine(cfg)`.
- [ ] 3.2 Implement the `say` engine (fallback) — spawn `say -v <voice> -r <rate>`, write the text to
  it, kill the child on `stop()`. macOS only; `available()` false elsewhere.
- [ ] 3.3 Implement the Google engine (default) — POST to `texttospeech.googleapis.com/v1/text:synthesize`
  with `{languageCode: "hu-HU", name: speech.voice}` and MP3 output, decode the base64 `audioContent`
  to a temp file, play it with `afplay`, and kill the player on `stop()`. Voice default
  `hu-HU-Chirp3-HD-Achernar`, proven in `set-voice-agent-delivery`.
- [ ] 3.4 Resolve the credential from `GOOGLE_TTS_API_KEY` in env / project `.env` / user `.env`,
  never from committed config — reuse the `SONIOX_API_KEY` resolution path.
- [ ] 3.5 Implement the fallback chain: no credential, network error, API error, or synthesis past
  `speech.deadlineMs` → speak the line with the local engine instead and record the cause. Never drop
  an utterance because the preferred engine failed.
- [ ] 3.6 Add a content-hash cache of synthesized audio so a repeated line costs no round-trip.
- [ ] 3.7 Make `resolveEngine` return a named "no engine" result when neither resolves, carrying the
  reason string that `speak on` and `doctor` print.
- [ ] 3.8 Unit-test what is testable without the network: credential resolution order, the fallback
  decision table (which cause → which engine), and cache hit/miss. The synthesis call itself is
  verified by running the CLI, per the repo's testing rule.

## 4. The follower

- [ ] 4.1 Create `src/speak-follow.ts` reusing `parseMirrorables` and `resolveTranscriptPath` from
  `src/mirror-follow.ts` (both already exported; do not copy them).
- [ ] 4.2 Add the runtime-dir constants and ownership: `speak.pid`, `speak-offset`, `speak.log`,
  `speak.enabled`; a live PID refuses a second follower, a stale PID is reclaimed.
- [ ] 4.3 Implement the drain pass: first-run and shorter-than-offset both resume at EOF and record
  the discontinuity; the offset advances only after the engine accepts the utterance; a failure
  leaves the offset untouched for the next pass.
- [ ] 4.4 Gate per pass, not at startup: speak only when `speak.enabled` exists AND no live
  `capture.pid` owns the dir. While gated, advance the offset and record the reason — never queue.
- [ ] 4.5 Implement barge-in: a newly speakable message calls `engine.stop()` on the utterance in
  progress and speaks the new one; a cut utterance counts as delivered and is not retried.
- [ ] 4.6 Implement `speak.log` (one record per considered message, naming the decision and the tier)
  with rotation at the line budget, mirroring `logMirror`.
- [ ] 4.7 Follow with `fs.watch` plus the safety interval, as `startMirrorFollow` does.
- [ ] 4.8 Write `src/speak-follow.test.ts` for the pure/decidable parts: gate evaluation (marker
  present/absent × capture live/dead), offset advance-on-success and hold-on-failure, first-run and
  truncation resume-at-EOF, log decisions. Use `SET_COPILOT_HOME` in anything that spawns the CLI.

## 5. CLI

- [ ] 5.1 Add `set-copilot speak-follow` (with `--transcript` / `--session` escape hatches, matching
  `mirror-follow`).
- [ ] 5.2 Add `set-copilot speak on|off` — create/remove the marker; `on` names the active engine,
  states plainly when it is remote (spoken text leaves the machine), and refuses to claim success
  when no engine resolves.
- [ ] 5.3 Add `doctor --speak`: follower alive, marker present, which engines resolved (local/remote,
  credential present or not), and last delivery time.
- [ ] 5.4 Extend `stop` to stop the speech follower alongside the mirror follower.
- [ ] 5.5 Extend `set-repair` to report an orphaned `speak.pid`.
- [ ] 5.6 Update `src/cli.test.ts` and the CLI help text.

## 6. Prompt / policy surface

- [ ] 6.1 Render the spoken-lead convention into `set-copilot prompt` from config (a `speech` block
  alongside the alerts and drawing contract) — not written into any skill.
- [ ] 6.2 Extend `src/copilot-prompt.test.ts`: the block appears when speech is enabled, is absent
  when disabled, and reflects a configured marker rather than a hardcoded one.

## 7. Verify end to end

- [ ] 7.1 `npm run build && npm test` clean.
- [ ] 7.2 Run the real CLI: `speak on`, write a message, hear it; `speak off`, hear nothing; `speak
  on` again mid-session with no restart.
- [ ] 7.3 Verify feedback suppression for real — start `/ds`, confirm nothing is spoken during the
  capture, and confirm the resulting transcript contains none of the machine's own words.
- [ ] 7.4 Verify barge-in: two messages in quick succession cut to the second.
- [ ] 7.5 Verify a silent follower is diagnosable — with the marker removed, with no engine, and with
  a dead follower, `doctor --speak` names the cause in each case.
- [ ] 7.6 Update `CLAUDE.md` (a `speak-follow` bullet in the architecture list, and the runtime-dir
  invariant note that the speech follower owns its four files under the same rules).
