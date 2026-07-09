---
name: ds
description: Start dictation (shortcut for /dictate start)
user_invocable: true
---

# ds — Start Dictation

Shortcut for `/dictate start`. Invoke the `dictate` skill with argument `start` plus any arguments passed here.

When invoked as `/ds` → run `/dictate start` (3 min default).
When invoked as `/ds 10` → run `/dictate start 10`.

**Implementation:** Call the Skill tool with `skill: "dictate"` and `args: "start <ARGUMENTS>"`. If no arguments provided, use `args: "start"`.
