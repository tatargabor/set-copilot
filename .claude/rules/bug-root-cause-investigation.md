---
paths: ["src/**", "skills/**", "hooks/**"]
---

# Investigate before fixing — the report is the symptom, not the diagnosis

## Re-measure before believing the report

The house example is in CLAUDE.md's mirror section: the field report said "the mirror
silently stopped at 20:52:39". Re-measuring the artifacts refuted it — the mirror was
alive to the end, and the real defect (a hook permanently one message behind) was worse
and different. A fix for the reported diagnosis would have fixed nothing. So the first
step is always to measure the artifacts yourself, not to reason from the report.

## The sources, in order

| # | source | what it answers |
|---|---|---|
| 1 | **runtime-dir artifacts and logs** — `transcript.jsonl` / `dictation.jsonl` and their archives, `capture.output`, `wall-events.jsonl` (and rotated copies), `wall-mirror.log`, `<command>.log` from `--detach`, `capture.pid` / `mirror.pid` / offsets | what actually happened, when, and how often — timestamps beat recollection |
| 2 | **the whole module**, not the line near the symptom | which branch produces it, and which sibling branch is wrong the same way |
| 3 | **`openspec/specs/<capability>/`** and **`git log -p -- <file>`** | what the behaviour is meant to be, and when and why it last changed — a "never existed" claim needs the log, not a guess |
| 4 | **the Claude Code session transcripts** (`~/.claude/projects/<slug>/*.jsonl`) | what the copilot or the user actually saw and said around the failure |

`set-copilot doctor` (audio chain) and `/set-repair` (runtime state) are the cheap first
probes; run them before reading code.

## The code may have moved past the report

Before fixing, check what changed in the area **since** the report (`git log --since`).
Three outcomes:

- **still a defect on today's model** → fix it against today's code;
- **already fixed** → show the commit, do not re-fix;
- **superseded** — the area was redesigned and the reported behaviour is now intended,
  or the need is better served elsewhere → **do not implement the reported fix**; it
  would be a regression. Name what superseded it (commit or change) and raise it with
  the user. This is the reassuring verdict, so it needs named evidence.

## Three questions before touching code

1. Does it still reproduce — shown from artifacts or a run, not assumed from the report?
2. Where does the bad state originate — this process, an upstream one (audio, Soniox,
   the flusher), config, or a consumer reading it wrong?
3. Is the obvious fix enough, or does the same class live in a sibling path
   (`whole-surface-and-scope.md`)?

Not applicable to a typo or a self-evident one-line mistake found while reading code.
