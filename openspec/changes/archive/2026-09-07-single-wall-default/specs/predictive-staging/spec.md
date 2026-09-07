## MODIFIED Requirements

### Requirement: The predictive mandate is box policy, not engine code

The instruction that makes the producer prepare ahead — draw the likely next visual during
a `silence` window, `zone:"private"` and `staged:true`, with a `visual` id the promotion
can name — SHALL live in config, not as logic in `src/`. Its home is the drawing contract
(`copilot.drawing` conventions), rendered into the producer policy alongside the payload
shapes and the promote rule. The engine owns the mechanism (the silence hook, staging, the
promote gate, expiry); the judgement of what is worth predicting is config, consistent with
the project's seam rule for `copilot.*` policy.

The mandate SHALL state the single-surface reality plainly: a staged draw has no display
surface until it is promoted — that is what makes preparation free of publication risk —
and `wall-staged` is how the producer asks what it has prepared. An unpromoted prediction
expiring is the correct outcome for a wrong guess.

#### Scenario: Tuning what gets predicted needs no engine edit

- **WHEN** a project wants to change what its producer prepares ahead for
- **THEN** it edits the drawing-contract conventions in config, and neither `src/` nor the
  engine mechanics change

#### Scenario: The mandate survives the box it used to live in

- **WHEN** the shipped default has no private staging box for the mandate to sit in
- **THEN** the rendered producer policy still teaches preparation, promotion, and expiry —
  because the mandate lives in the drawing contract, not in a window's box policy
