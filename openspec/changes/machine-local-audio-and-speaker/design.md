# Design

## D1 — Which keys are per-machine

`audio.micSource`, `audio.monitorSource`, `audio.sampleRate`, `audio.toneStart`, `audio.toneEnd`
(i.e. the whole `audio` section — every key in it describes the local audio chain), and
`transcript.speakers.mic`. Not `transcript.speakers.system`: that label names "the other side of
the call", a property of how a project's meetings run, not of a person.

One list, `MACHINE_LOCAL_KEYS`, exported from `config.ts` and used by the merge, the diagnostic
and the mover, so the three cannot disagree.

## D2 — Resolution: machine first, for those keys only

`audio` already merges per key with "empty string = not set" (`mergeAudio`). The fix swaps the
operands: `mergeAudio(project, user)`. The empty-is-unset rule then protects the project value
from a scaffolded empty machine value, exactly as it protected the machine value before.

`transcript` keeps its current one-level merge (`speakers` taken whole from the higher layer);
afterwards, a non-empty user `speakers.mic` overrides `mic` in the result. So a project that
labels `system` keeps that label, and the machine's person label wins for `mic`.

Everything else keeps "project wins". This is the narrowest change that removes the conflict
source; a general "user wins" would break the project's ownership of its own vocabulary.

## D3 — Writers write to the machine

The only writer of a per-machine key into a project file is `init` (project mode), which copies
the example config with its `audio: { micSource: "", monitorSource: "" }` placeholder — the exact
scaffold that cost an afternoon on 2026-08-27. Project-mode `init` now writes the example
without its `audio` section. The v1 migration already moves device names into the user config.
There is no "setup" or "digest" writer of these keys in the code (`grep writeFileSync` over
`src/`: preflight, init, poll offsets, stitch artifacts, wall/replay files).

## D4 — `doctor` warns on a tracked project config; `--fix` moves

"Tracked" is `git ls-files --error-unmatch set-copilot.config.json` in the project root; an
untracked or ignored project config is not a conflict source and is not flagged by the new
finding (the existing device-name finding keeps its own, unconditional rule, and the new finding
does not repeat the keys that one already names).

`--fix` is deliberately not a `configVersion` migration: migrations apply themselves on every
command, and that would rewrite every consumer project's tracked config the next time any
command ran there. The task asks for a mechanism the owner invokes. The decision logic is a pure
function beside the migrations (`moveMachineLocalKeys`), reusing the preflight's write path
(`.bak` first, then write), and is unit-tested against fixtures.

Never overwriting a machine value follows migration v1: a value the machine declares is, by
construction, the right one for this hardware/person. The dropped project value is printed, so
nothing disappears silently.
