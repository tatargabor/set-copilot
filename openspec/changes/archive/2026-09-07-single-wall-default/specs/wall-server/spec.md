## ADDED Requirements

### Requirement: The root path reaches the wall

When no declared window claims the server root path (`/`), a request for it SHALL redirect
to a declared window's route rather than serve a page that cannot resolve a window: the
client derives its route from the location pathname, so a page served at `/` with no window
there would bootstrap-fail. When a project declares a window at `/`, that window SHALL be
served directly and no redirect SHALL occur.

#### Scenario: Root redirects to the single declared window

- **WHEN** the shipped default serves one window on `/wall` and a browser requests `/`
- **THEN** the server responds with a redirect to `/wall`, and the page there bootstraps
  normally

#### Scenario: A window declared at the root is served, not redirected

- **WHEN** a project config declares a window with route `/` and a browser requests `/`
- **THEN** the server serves that window's page directly
