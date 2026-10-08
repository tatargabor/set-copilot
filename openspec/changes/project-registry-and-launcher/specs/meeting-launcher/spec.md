## Purpose

The one-command front door to a meeting: resolve the project, verify the audio/STT chain is actually up, and hand over to a Claude Code session that runs the meeting-copilot skill — the launcher opens the door and never owns the runtime dir.

## ADDED Requirements

### Requirement: Project resolution
`set-copilot meeting` SHALL resolve exactly one project directory before doing anything else, in this order: an explicit `--project <name-or-path>` argument, then the most recently used registry entry, then the current directory. An ambiguous `--project` value matching more than one registry entry SHALL fail naming the candidates.

#### Scenario: Explicit argument wins
- **WHEN** the user runs `set-copilot meeting --project <name>` while a different project was used more recently
- **THEN** the named project is used

#### Scenario: Ambiguous name fails with candidates
- **WHEN** two registered projects' names or paths match the same `--project` value
- **THEN** the command exits non-zero and lists the matching projects

#### Scenario: Bare invocation in a project directory
- **WHEN** the registry is empty and the user runs `set-copilot meeting` inside a project directory
- **THEN** the current directory is used

### Requirement: Preflight gate
Before spawning anything, the launcher SHALL run the existing `doctor` probe for the resolved project. If the probe reports a failure that leaves the meeting unable to hear (missing audio binary, no signal path, no resolvable STT backend), the launcher SHALL print the probe output and start nothing, exiting non-zero. Warnings that leave a degraded-but-working path (for example, a missing system-audio loopback device that still permits mic-only capture) SHALL NOT block the launch but SHALL be shown. The launcher SHALL also verify that the meeting-copilot skill is discoverable for the resolved project — present and non-dangling in the project's or the user's skills directory; if it is not, the launcher SHALL print a message naming the command that installs it and start nothing.

#### Scenario: Dead audio chain blocks the launch
- **WHEN** the audio capture binary is missing or cannot deliver bytes
- **THEN** the doctor output is shown, no Claude session is started, and the exit code is non-zero

#### Scenario: Passing preflight starts the session
- **WHEN** the doctor probe reports the audio chain and STT credentials working
- **THEN** the Claude Code session is started in the project directory

#### Scenario: Degraded system audio does not block
- **WHEN** the probe warns that system-audio capture is unavailable but mic capture works
- **THEN** the warning is displayed and the session starts anyway

#### Scenario: Missing skill blocks with the fix named
- **WHEN** no readable meeting-copilot skill exists in the project's or the user's skills directory
- **THEN** the launcher prints a message naming the install command and starts no session

#### Scenario: Symlinked and copied installs are equally valid
- **WHEN** the meeting-copilot skill reaches the skills directory either as a checkout symlink or as a copied file from a global install
- **THEN** the check passes identically in both cases

### Requirement: The session owns the meeting lifecycle
The launcher SHALL start the Claude Code session in the project directory with the `/meeting-copilot start wall` opening prompt (additional skill mode words MAY be passed through), and SHALL NOT itself start the capture, the wall, or any other runtime process. The runtime dir, capture PID, wall, and transcript hand-over remain owned by the session exactly as when started by hand. At launch, the launcher SHALL record the launch as a use of the project (updating `lastUsedAt`).

#### Scenario: Runtime dir is owned by the session, not the launcher
- **WHEN** a meeting is started through the launcher and later stopped with the skill's `stop`
- **THEN** the transcript is handed over exactly once in the session-scoped runtime dir under the project, identical in behavior to a meeting started by hand

#### Scenario: Launch records usage
- **WHEN** a meeting is started for a registered project
- **THEN** that project's `lastUsedAt` is updated, making it the resolution target of the next bare `set-copilot meeting`

### Requirement: Platform gate
The launcher SHALL work on macOS and Linux through one code path. On platforms where audio capture is unsupported, it SHALL refuse before any probe or spawn with a message naming the limitation.

#### Scenario: Unsupported platform refuses up front
- **WHEN** `set-copilot meeting` is run on an unsupported platform
- **THEN** it prints an actionable refusal and exits non-zero without probing audio or starting a session
