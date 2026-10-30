## MODIFIED Requirements

### Requirement: The wall page can send a short message to the session

The wall page SHALL offer a small input in its status strip, present in every layout unless the
presentation setting `wall.presentation.hideInput` is true (for a wall that is only ever shown to an
audience): typing a line and submitting it SHALL POST the text to the wall server, and the page SHALL
confirm the outcome to the viewer without fabricating any display event. The input SHALL NOT take focus
automatically — the page is a shared screen.

#### Scenario: A message sent from the wall is confirmed locally

- **WHEN** the operator types a line into the strip input and submits it, and the server
  accepts it
- **THEN** the page shows a transient confirmation on the strip, and no display event is
  added to the wall's content streams

#### Scenario: A failed send says so

- **WHEN** the server rejects or cannot be reached
- **THEN** the page shows a transient failure indication instead of a confirmation

#### Scenario: The input can be hidden for a presentation wall

- **WHEN** `wall.presentation.hideInput` is true
- **THEN** the status strip SHALL render without the input, and the rest of the strip is unchanged
