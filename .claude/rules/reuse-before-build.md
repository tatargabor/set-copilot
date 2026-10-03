# Scan for the existing mechanism before building one

> Always loaded, so it is short. The failure: writing new code first, when the mechanism,
> the config seam, or the skill for it already exists.

**Before writing non-trivial new code, run a reuse scan and quote what it found:**

1. **`src/`** — grep for the function or pattern. This repo has many single
   implementations on purpose (`mirror-policy`, the stitch's renderers, `ingest` for every
   wall producer); a second path next to one is a defect, not a feature.
2. **Config seams and keys** — `src/config.ts` defaults and CLAUDE.md "Everything
   project-specific is config". If the behaviour is project- or language-specific, it
   belongs behind an existing seam (`copilot.*`, `detect.*`, `knowledge.*`,
   `transcript.*`, `wall.*`), not in new engine code or a new key that duplicates one.
3. **Skills and subcommands** — `skills/` and `set-copilot help`: `doctor`, `set-repair`,
   `transcript-recover`, `replay` may already answer it.
4. **Recent history** — `git log --oneline -15` and `git log --since='3 hours ago'`: a
   parallel session may have just done it, or it was built and later removed.
5. **Memory** — the project memory index, for an earlier decision or lesson on the topic.

If something is found, **extend it**. If the scan is empty, build — and say what you
searched.

**Scan before declaring a blocker too.** "X must be verified first" or "this needs an
external spike" often has its answer in our own code (what we actually send, what the
config already allows). A false blocker produces no artifact and no review catches it;
write down what you checked before recording one.
