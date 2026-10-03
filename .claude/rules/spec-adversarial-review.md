---
paths: ["openspec/changes/**"]
---
# Adversarial review between propose and apply — mandatory

## The rule

**No `/opsx:apply` until `openspec/changes/<name>/review-findings.md` exists and has no OPEN
CRITICAL.** The cycle is propose → `/opsx:review` → apply → verify → archive.

`/opsx:review` (`.claude/commands/opsx/review.md`) runs two named agents **blind and in
parallel**:

- `adversarial-code-reviewer` — assumes the plan is wrong and tries to refute it against the
  real code, with `path:line` evidence.
- `rules-conformance-auditor` — checks the artifacts against CLAUDE.md, the `rules:` in
  `openspec/config.yaml` and `.claude/rules/*.md`, PASS / FAIL / N-A per rule.

Neither sees the other's output, and neither is shown the main session's opinion of the
plan. Do not replace them with an ad-hoc "look it over" prompt.

## Why

A plan can be internally consistent and pass `openspec validate --strict` while not fitting
the code at all; validation measures the spec's shape, not its truth. Most of the
invariants in CLAUDE.md exist because a change looked complete and was not: the `audio`
config section left out of the per-key merge, `||` where `??` was needed, `\b` breaking
accented words, a hook that was one message behind. Each was visible in the code before it
shipped — to a reader who went looking for it instead of reading the plan.

## Handling findings — two branches

Every finding has a severity (`CRITICAL` / `MAJOR` / `MINOR`) and a status
(`OPEN` / `RESOLVED` / `REJECTED`).

1. **Fixed in the artifacts.** Change proposal.md, design.md, tasks.md or the delta spec so
   the defect is gone, then mark the finding `RESOLVED — <where>`. Fixing it only in your
   head, or "during apply", does not count: the artifacts are what apply reads.
2. **Explicitly rejected.** Mark it `REJECTED — <reason>`. A bare `REJECTED` counts as
   OPEN. Rejecting a **CRITICAL** needs the user's explicit OK, recorded on the line
   (`(user OK, <date>)`); the agent never waives a CRITICAL on its own judgement.

- **CRITICAL** blocks apply until one of the two branches closes it.
- **MAJOR** should be resolved before apply; leaving one open is the user's call, recorded.
- **MINOR** may become a task; it does not block.
- A business or architectural fork the review uncovers goes under *Open decisions* in the
  findings file — the user decides, not the agent.

## Exemptions

A trivial change may skip review, but **must say so in proposal.md** with the reason, e.g.
`Review: skipped — docs-only` or `Review: skipped — retro-spec, describes shipped behaviour
only, no code task`. Valid reasons:

- docs-only (no file under `src/`, `skills/`, `hooks/` or config defaults changes);
- a retro-spec that only describes behaviour already in the code, with no implementation task.

If tasks.md contains a code task, the exemption does not hold. An unstated skip is a missing
review, not an exemption.

## What this rule does not do

There is no machine gate: nothing blocks a commit or a push. The rule binds through
`/opsx:apply` (its guidance in `openspec/config.yaml` checks for the findings file) and
through you. When the guidance and the findings file disagree, the findings file wins.
