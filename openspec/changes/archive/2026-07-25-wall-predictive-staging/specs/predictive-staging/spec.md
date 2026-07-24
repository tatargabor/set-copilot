## ADDED Requirements

### Requirement: Prediction prepares in the private zone, never publishes autonomously

A prediction — content generated from where the conversation appears to be heading, before it has been
said — SHALL be emitted only to the private zone. It SHALL NOT reach a public client automatically. The
wall's authority rule holds: a guess may inform the operator privately, but it SHALL NOT appear on the
public wall as if it were established.

This is the load-bearing invariant of this capability. Every other requirement below serves it.

#### Scenario: A predicted visual stays private until promoted

- **WHEN** the copilot draws a visual for a topic the conversation is trending toward but has not yet
  reached, and emits it as a prediction
- **THEN** only the private view receives it; no public client receives it until an explicit promote

#### Scenario: No autonomous public prediction

- **WHEN** a prediction exists in private staging and no promote has occurred
- **THEN** the public wall shows nothing new from that prediction, regardless of how confident the
  prediction is

### Requirement: The silence window drives preparation, not publication

The copilot SHALL use the `silence` event as a preparation window: a short (one- to two-step)
extrapolation of where the conversation is heading, used to pre-draw a visual or surface relevant prior
context into private staging. The extrapolation SHALL govern what is *prepared*, never what is
*published*.

#### Scenario: A pause triggers private preparation

- **WHEN** a `silence` event arrives and the recent conversation trends toward a drawable structure
- **THEN** the copilot prepares a private staged visual for the likely-next topic, and the public wall
  is unchanged

### Requirement: Promotion is human- or rule-gated and cheap

A staged private visual SHALL be promotable to the public zone only through an explicit gate: a
documented rule (for example, the conversation reaching the predicted topic) or a single operator
confirmation. Because the expensive draw already exists, promotion SHALL be a cheap zone-lift (on the
order of a `show`/emit), not a re-draw.

#### Scenario: Promotion lifts an existing visual, it does not redraw

- **WHEN** the conversation reaches the predicted topic and the gate fires
- **THEN** the already-prepared visual is lifted to the public zone without regenerating it

#### Scenario: Promotion into a redacted zone still obeys redaction

- **WHEN** a staged visual is promoted to a `both`/public zone and the `wall-public-redaction`
  capability is present
- **THEN** the promoted event passes the same redaction as any other event entering the public zone

### Requirement: An unused prediction expires quietly

A staged prediction that is not promoted SHALL expire after a bounded window or when the conversation
demonstrably diverges from it. Expiry SHALL release the staged visual with a marker in the private
view, so a stale guess never sits on the private canvas as lingering visual noise, and never becomes
promotable after it has gone stale.

#### Scenario: A diverged prediction is released

- **WHEN** the conversation moves away from a staged prediction and the expiry window passes
- **THEN** the staged visual is released, marked as expired in the private view, and is no longer
  eligible for promotion

### Requirement: The predictive mandate is box policy, not engine code

The instruction that makes a box prepare ahead — "surface what they may not know, and what they are
about to need" — SHALL live in the private box's policy (`box-policy` config), not as logic in `src/`.
The engine owns the mechanism (the silence hook, staging, the promote gate, expiry); the judgement of
what is worth predicting is config, consistent with the project's seam rule for `copilot.*` policy.

#### Scenario: Tuning what gets predicted needs no engine edit

- **WHEN** a project wants to change what its private box prepares ahead for
- **THEN** it edits the box's policy in config, and neither `src/` nor the engine mechanics change
