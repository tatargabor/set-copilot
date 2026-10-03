---
paths: ["openspec/**"]
---

# OpenSpec conventions

Applies whenever you create, edit, implement, verify or archive anything under
`openspec/`. The gate's own checks are in `set-spec-verify-gate.md`; the two archive
invariants (dependency order; a `MODIFIED` requirement carries every base scenario) are in
CLAUDE.md "OpenSpec workflow" — not repeated here.

## Edit through the skills, validate after

Create and change artifacts with `/opsx:propose`, `/opsx:new`, `/opsx:continue`,
`/opsx:ff`, `/opsx:update`, `/opsx:apply`, `/opsx:archive` — not freehand Edit/Write. The
skills read the live `openspec/specs/<capability>/spec.md`, so a `## MODIFIED` aligns to a
requirement that actually exists, and they enforce the silently breakable format:
`## ADDED/MODIFIED/REMOVED`, `### Requirement:` with SHALL/MUST in the text, exactly
`#### Scenario:` with WHEN/THEN. A prose typo in a proposal may be fixed by hand; a
requirement or scenario may not.

After **any** change to an artifact, run `openspec validate <change>` (and
`openspec validate --specs --strict` after an archive) before calling it done. The bare
CLI is fine for read-only inspection (`openspec list`, `status`, `show`).

## Reading order before writing an artifact

1. **`openspec/specs/`** — today's truth. Every archived delta is merged here; a proposal's
   modified capabilities name these exactly.
2. **Active changes** in `openspec/changes/` — a sibling may already touch the same
   requirement; a delta written against a requirement another active change is rewriting
   will merge stale.
3. **`CLAUDE.md`, then `docs/`** (`ROADMAP.md`, `replay-harness.md`, field notes) — the
   rationale and the invariants, which specs state as behaviour but not as reasons.
4. **The code** — ground truth for *how it works now*. Where code and spec disagree, do
   not assume the code is wrong: decide which one is intended and fix the other in the
   same change.

## Scope: IN SCOPE / OUT OF SCOPE

Every delta spec carries **both** `## IN SCOPE` and `## OUT OF SCOPE`. OUT OF SCOPE lists
the neighbouring, obvious items deliberately deferred — not the whole world; if nothing
is deferred, say so in one line (a stated negative is an answer, a missing section is
not). When implementing, build only what IN SCOPE names; a task that reaches into OUT OF
SCOPE stops and is raised with the user.

## Traceability

Every implementation task in `tasks.md` carries `[REQ: <requirement name>]`, matching a
`### Requirement:` in the change's delta specs. A requirement no task covers, or a task
tagged with nothing, is what `/opsx:verify` reports — fix it in the artifacts, do not
explain it away in the report.

## Capability names

A capability name is durable: it outlives the change that created it and is referenced
by every later delta. Name it for the **behaviour** it specifies (`transcript-stitch`,
`public-redaction`, `mirror-follower`), never for a file, a class, a ticket, a date, or
the change that introduced it. Before adding a capability, check the existing list in
`openspec/specs/` — extending one beats a near-duplicate. Renaming one is itself a change.
