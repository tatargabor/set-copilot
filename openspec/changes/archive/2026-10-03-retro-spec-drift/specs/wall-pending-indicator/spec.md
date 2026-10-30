## ADDED Requirements

### Requirement: A pending marker is never replayed state

A pending marker is transient feedback about a draw in flight, not content: the server SHALL broadcast it
through the zone gate like an event but SHALL NOT accumulate it, so a window that connects or reloads
later never reconstructs a placeholder for a draw that may long since have finished or died. A client
that receives a full-replay announcement SHALL clear any placeholder it is showing along with the rest of
its boxes.

#### Scenario: A late joiner sees no stale placeholder

- **WHEN** a window connects while a draw it would have shown a placeholder for is in flight
- **THEN** it SHALL show no placeholder for that draw, and SHALL show the real visual when it arrives

#### Scenario: A full replay clears the placeholder

- **WHEN** a client showing a placeholder receives a full-replay announcement
- **THEN** the placeholder SHALL be cleared together with the box contents being rebuilt
