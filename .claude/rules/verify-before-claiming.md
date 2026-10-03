# "Done" only with evidence from this turn

> Always loaded, so it is short. The failure it prevents: claiming success from a proxy
> ("the code looks right", "the targeted test is green") instead of running the real path.

Write **done / works / fixed / ready** (or a synonym) only when the matching evidence was
produced **in the same turn**, and quote it (the command and the relevant output line):

| Claim | Evidence |
|---|---|
| types / it compiles | `npm run build` — tsc strict is the only static check (no linter) |
| logic is correct | `npm test`, or a named run: `npx vitest run src/<file>.test.ts` / `-t "<name>"`. A targeted green is evidence about that file only — say so, or run the full suite |
| audio, Soniox, the PID lifecycle, detach | run the CLI (`npm run dev -- <cmd>` or the built `set-copilot`), or `set-copilot doctor` (`--mirror` for the follower). **The tests do not cover these paths** — a green suite proves nothing about them |
| idempotent / handed over exactly once | run it **twice** and show the second run did nothing extra (no replayed transcript, no second PID, no duplicate wall line) |
| a skill change takes effect | from a checkout `init` **symlinks** `skills/` into `~/.claude/skills/`, so the edit is live — but a running session loaded the old text. State whether a new session is needed to see it |
| specs are consistent | `openspec validate --specs --strict` (and `openspec validate <change>` for a change) |
| it is in the package | `npm run build` then the CLI from `dist/` — `bin` and `exports` point there, not at `src/` |

**A failure is reported with its output**, not paraphrased: the failing test name and
assertion, the tsc error line, the CLI's stderr. "Some tests fail" is not a report.

**If you could not produce the evidence** (no microphone, no Soniox key, no time), say
exactly that: *"written, NOT verified by running — unverified: <what>"*. "Should work" and
"probably fixed" are not allowed; it is evidence or an explicit "unverified".

**A check measures the working tree, not what is committed or pushed.** An uncommitted
edit, another session's half-finished file, or a different branch checked out all change
what ran — before claiming a commit is good, make sure the tree you tested is that commit.

Not applicable to plan discussion, or to a self-evident edit (a typo) — but even there,
never claim runtime behaviour without a run.
