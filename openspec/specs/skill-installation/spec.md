# skill-installation Specification

## Purpose
Keep an installed skill identical to the skill the package ships. `init` used to copy, so the
install was a snapshot of a directory that keeps moving — and nothing refreshed it or reported it.
This capability governs where `init` puts the skills, how it decides between tracking a source and
freezing one, and what it must say and preserve while doing so.

## Requirements

### Requirement: A checked-out repo is the source of the installed skills, not a snapshot of it

When the package runs from a git checkout, `init` SHALL install each skill as a **symbolic link** to
that checkout's `skills/<name>` directory, so an edit to the source is the installed skill with no
second step. When the package runs from an installed location with no tracking source (an npm
install under `node_modules`), it SHALL copy, as today.

The mode SHALL be decided per run from where the package itself lives, never from what happens to
be at the destination, and an operator SHALL be able to force copying.

#### Scenario: Installing from a checkout links

- **WHEN** `init` runs from a package whose root is a git checkout
- **THEN** each `<skills-dest>/<name>` is a symbolic link to `<repo>/skills/<name>`, and reading the
  installed `SKILL.md` yields the source file's current contents

#### Scenario: Installing from an npm package copies

- **WHEN** `init` runs from a package installed under `node_modules`
- **THEN** each skill is copied, exactly as before this change

#### Scenario: Copying can be forced from a checkout

- **WHEN** `init` runs from a checkout with the copy mode explicitly requested
- **THEN** the skills are copied and the run reports that it copied

### Requirement: The installer declares which mode it is in and what it points at

`init` SHALL state, in its output, whether it linked or copied, and — when it linked — the source
path the links resolve to. Silence about the mode reproduces the same class of failure in the
opposite direction: with a copy the operator's edit to the source never takes effect, and with a
link an edit to the installed copy changes the repo; either is invisible without the declaration.

#### Scenario: Link mode is stated with its target

- **WHEN** `init` installs by linking
- **THEN** the output names the link mode and the source directory the skills resolve to

#### Scenario: Copy mode is stated

- **WHEN** `init` installs by copying
- **THEN** the output names the copy mode, so an operator editing the source knows a re-run is
  required for it to take effect

### Requirement: A dangling link is refused rather than created or kept

`init` SHALL verify that a link's target exists before creating it, and SHALL replace an existing
installed entry that is a link whose target no longer exists, reporting it. A dangling symlink makes
the skill disappear from the session's skill list with no error at any layer, which is the one
failure mode indistinguishable from "this skill was never written".

#### Scenario: A missing source is not linked

- **WHEN** `init` would link a skill whose source directory does not exist
- **THEN** no link is created for it, and the run reports the missing source

#### Scenario: A leftover dangling link is replaced

- **WHEN** an installed entry is a symbolic link whose target no longer exists
- **THEN** `init` replaces it with a valid installation and reports that it did

### Requirement: An existing real directory is archived, never silently deleted

When an installed entry is a real directory and `init` is about to replace it with a link, the
directory SHALL be archived to a timestamped sibling (`<name>.bak-<timestamp>`) rather than removed.
This is the same hand-over rule the transcript archive and the wall event log already follow:
whatever local edit that directory holds outlives the install.

#### Scenario: Replacing a copy preserves it

- **WHEN** `init` replaces an installed real directory with a link
- **THEN** the previous directory remains readable under a timestamped `.bak-<timestamp>` name, and
  the run reports where it went

#### Scenario: Replacing a link needs no archive

- **WHEN** `init` replaces an installed entry that is already a link to the same source
- **THEN** no archive is created, because a link holds no content of its own

### Requirement: The installer reports the skills it actually installed

`init` SHALL derive the reported skill names from what it wrote, and SHALL name any skill it did not
install. A fixed list printed regardless of outcome reports work that did not happen: measured
2026-08-09, the message named all six skills while `set-repair` and `transcript-recover` were absent
from the destination entirely.

#### Scenario: Report matches the destination

- **WHEN** `init` finishes
- **THEN** the reported names are exactly those now present at the destination

#### Scenario: A skipped skill is named

- **WHEN** a skill is not installed because its source is missing
- **THEN** the run names that skill as not installed rather than counting it among the installed
