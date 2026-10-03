# Fix the class, not the instance — but keep the change the size of the request

> Always loaded, so it is short. Two opposite failures: a fix too narrow, a change too wide.

## 1. Cover the whole class of defect

A report names one instance; the defect is usually a class. Before calling a fix done,
read the **whole** module (not the lines around the symptom) and check the siblings:

- the **mic AND the system** channel (dictation hides system-channel bugs — the
  cross-channel flush bug stayed invisible for exactly that reason);
- **parec AND sox**, **Linux AND macOS**;
- **everything that reads the runtime dir** (`capture`, `stop`, `poll`, `status`,
  `mirror-follow`, `wall`, `replay`, the `set-repair` skill …) — a path change must keep
  them identical;
- **capture AND replay** — both write the transcript the consumers read;
- the archived files as well as the live one, and data written **before** the change.

Fix the siblings together, or state in the commit why one is not affected.

## 2. Do what was asked, report the rest

If the request names a concrete, bounded action, do that. Do not add configurability, a
new config key, an extra subcommand, or a refactor of a neighbouring module without a
one-line question first ("only X, or Y too?"). **Adjacent findings are reported, not
fixed silently** — list them at the end of the turn so the user decides; an unrequested
fix hidden in a diff is a review burden and a scope the spec never saw
(`opsx-before-nontrivial.md`).

Not applicable when the user explicitly asks for the general solution, or when the
sibling enumeration is provably empty.
