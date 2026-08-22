# E2E Test Infrastructure Evolution

Before writing E2E tests, discover and extend the project's shared test infrastructure.

## Before writing any E2E test

1. **Read existing helpers** — Check `tests/e2e/helpers/` (or equivalent). Understand what utilities exist: mock servers, seed data functions, navigation helpers, auth fixtures.

2. **Identify gaps** — What does your feature need that doesn't exist? Examples:
   - New mock server (WebSocket, external API)
   - New seed data helper (pre-populate state for your tests)
   - New navigation pattern (test route, page setup)
   - New assertion helper (custom matchers for your domain)

3. **Extend shared helpers** — Add new utilities to `tests/e2e/helpers/`, not inline in your spec file. Other changes will need them too.

4. **Write tests using helpers** — Import from the shared helpers. Avoid duplicating patterns that already exist.

## Why this matters

Each change builds on previous changes. When you define a helper inline (like `async function waitForWsConnected(page)` in your spec file), the next change that needs the same pattern reinvents it — often slightly differently, causing inconsistencies and maintenance burden.

Shared helpers create a growing test toolkit that makes each subsequent change easier to test.
