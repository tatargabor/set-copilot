## Purpose

A persistent, per-user registry of known copilot projects plus discovery of candidates, so a launcher can answer "which project?" without the user re-typing paths — advisory by construction, never a prerequisite for using a project directory directly.

## ADDED Requirements

### Requirement: Persistent per-user project registry
The system SHALL store known projects in a single JSON file inside the user-level set-copilot config directory (the same directory as the user-level `set-copilot.config.json`). Each record SHALL carry at least: the project's absolute path, a display name (defaulting to the directory basename), an `addedAt` timestamp, and a `lastUsedAt` timestamp.

#### Scenario: Adding a project persists it
- **WHEN** the user runs `set-copilot project add` with a project directory
- **THEN** the directory is recorded with its basename as the name and the registry survives process exit (a later `set-copilot project list` shows it)

#### Scenario: A relative path is normalized
- **WHEN** the user adds a project given as a relative or non-canonical path
- **THEN** the stored record identifies the directory by its canonical absolute path

### Requirement: Project registry CRUD
The system SHALL provide `set-copilot project list`, `project add [path]` (defaulting to the current directory), and `project remove <name-or-path>`. Adding a project whose canonical path is already registered SHALL update the existing record rather than create a duplicate. Removing SHALL accept either the display name or the path.

#### Scenario: Adding the same project twice yields one record
- **WHEN** the user adds the same directory twice (once via a symlinked or differently-spelled path)
- **THEN** the registry contains exactly one record for that canonical path

#### Scenario: Removing an unknown project fails clearly
- **WHEN** the user removes a name or path that is not registered
- **THEN** the command exits non-zero with a message naming what was not found, and the registry is unchanged

### Requirement: Discovery scan
The system SHALL provide `set-copilot project scan`, which produces candidate projects by merging two sources: a depth-limited filesystem scan for directories containing a `.git` entry under configured scan roots, and the per-user Claude Code project history decoded back to real directory paths. Candidates whose directory no longer exists SHALL be dropped, duplicates SHALL be collapsed by canonical path, and results SHALL be ordered most-recently-used first. Scan roots SHALL come from configuration (`projects.scanRoots`); when unset, the system SHALL use a small default set of common code directories. Scan roots that do not exist SHALL be skipped without failing the scan.

#### Scenario: A project known to both sources appears once
- **WHEN** a directory is both a git repository under a scan root and present in the Claude Code project history
- **THEN** the scan output lists it exactly once

#### Scenario: A vanished history entry is not listed
- **WHEN** the Claude Code project history names a directory that no longer exists on disk
- **THEN** the scan output does not include it

#### Scenario: Recency ordering
- **WHEN** the scan returns multiple candidates
- **THEN** the candidate used most recently (by Claude Code history) sorts first

### Requirement: Advisory posture
A missing, corrupt, or unreadable registry SHALL be treated as an empty registry with a warning on stderr, and no verb SHALL fail because of registry state alone. Registration SHALL never be required: any project directory remains fully usable without being registered.

#### Scenario: Corrupt registry degrades to empty
- **WHEN** the registry file exists but is not valid JSON, and the user runs `set-copilot project list`
- **THEN** a warning is printed to stderr, the command exits 0 with an empty list, and no other behavior changes

#### Scenario: Unregistered project still works
- **WHEN** the user starts a meeting in a directory that was never registered
- **THEN** the meeting proceeds identically to a registered one
