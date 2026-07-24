## ADDED Requirements

### Requirement: Narration is a continuous stream, distinct from the alert taxonomy

The copilot SHALL treat narration as its own channel: a running, substantive commentary of what is being
discussed, emitted on a regular cadence rather than only when an alert category (contradiction, context,
new decision, question) fires. The alert taxonomy SHALL remain event-triggered and unchanged; narration
SHALL NOT be modelled as a fifth alert category that fires on an event.

#### Scenario: Narration updates without an alert firing

- **WHEN** the conversation proceeds through ordinary discussion that matches no alert category
- **THEN** the narration box still receives a fresh, substantive line describing what is currently being
  discussed, and the alert channel stays silent

#### Scenario: Alerts remain independent of narration

- **WHEN** a contradiction (or any alert category) fires
- **THEN** it is delivered through the alert channel as before, independently of the narration stream, and
  neither suppresses the other

### Requirement: Narration cadence is regular, not per-token and not per-alert

The narration box SHALL update on a bounded, regular rhythm — at most once per reaction batch and at the
`silence` window — so that it reads as continuously alive without flooding. It SHALL NOT emit one line per
transcript token, and SHALL NOT wait for an alert to update.

#### Scenario: A pause refreshes the narration

- **WHEN** a `silence` event arrives after a stretch of discussion
- **THEN** the narration box shows an up-to-date line reflecting the substance of what was just said

#### Scenario: Rapid speech does not flood the box

- **WHEN** many transcript lines arrive in quick succession
- **THEN** the narration box is updated at most once per reaction batch, not once per line

### Requirement: Narration is substantive — the NO-FILLER rule holds

Every narration line SHALL carry substance: what is being discussed, what is being decided, or how it
relates to the knowledge base. Filler acknowledgements ("I'm listening", "waiting", "still here"), bare
restatements of the raw transcript, and empty status pings SHALL NOT be emitted as narration.

#### Scenario: Nothing substantive to add yields no filler

- **WHEN** the latest batch contains nothing the copilot can substantively summarize or relate
- **THEN** the narration box keeps its previous line rather than emitting a filler placeholder

#### Scenario: A narration line names the substance

- **WHEN** the copilot narrates an ongoing discussion of a known topic
- **THEN** the line states the topic/decision/relation (not "they are talking"), optionally citing the
  knowledge source, within the configured line budget

### Requirement: Verbosity is configurable and defaults louder than silent-reactive

How much the copilot narrates SHALL be governed by project configuration rendered into the session policy,
not by logic hard-coded in `src/`. The default SHALL be more talkative than today's reactive silence, and a
project SHALL be able to raise, lower, or disable narration without editing the skill or the engine. The
existing `engagement` setting that governs *chat* about content SHALL remain independent of narration
verbosity.

#### Scenario: A project tunes narration without forking

- **WHEN** a project sets its narration verbosity (or disables it) in configuration
- **THEN** the rendered policy reflects the setting, and no skill or `src/` change is required

#### Scenario: Narration disabled restores prior behavior

- **WHEN** narration is disabled in configuration
- **THEN** the policy output and runtime behavior are byte-for-byte the pre-change reactive behavior

### Requirement: Narration is private by default

Narration SHALL be emitted to the private view by default. It SHALL NOT reach a public client automatically;
promotion of narration to a public wall SHALL depend on the zone model and the separate public-redaction
capability, because live narration in front of an audience is unsafe without redaction.

#### Scenario: Narration stays off the public wall

- **WHEN** the copilot narrates and a public wall is connected
- **THEN** the public wall receives no narration line unless an explicit, redaction-gated promotion path is
  configured
