# Spec Delta

## Purpose

Put any web page on the wall as a picture: `set-copilot wall-shot <url>` renders the page with a
headless Chromium-family browser and emits the PNG as an `image` event. It exists because many
pages refuse to be framed (`X-Frame-Options`, CSP `frame-ancestors`), and the wall is a display,
not a runtime — a static shot loses nothing an embedded frame could offer.

## ADDED Requirements

### Requirement: wall-shot renders a URL with a headless browser at a fixed size

`set-copilot wall-shot <url> [--category <id>] [--zone both|private|public] [--caption <text>]`
SHALL find a browser by trying, in order, `chromium`, `chromium-browser`, `google-chrome`,
`google-chrome-stable`, `chrome`, using the first whose `--version` exits successfully. It SHALL
render the URL headless at a 1280×800 window with scrollbars hidden, and SHALL give up after
45 seconds so a page that never settles cannot hang the command.

The command SHALL exit non-zero with a message when no URL is given, when no browser is found
(naming every binary it tried), or when the browser fails, times out, or produces no file.

#### Scenario: No browser installed

- **WHEN** none of the five browser binaries is available
- **THEN** the command exits non-zero and its message lists all five names it tried

#### Scenario: A page that never settles

- **WHEN** the rendered page does not finish within 45 seconds
- **THEN** the browser is stopped and the command exits non-zero without emitting anything

### Requirement: The shot is emitted as an in-project image, or not at all

The PNG SHALL be written under `<runtimeDir>/shots/` with a timestamped name, and SHALL be
emitted as a single `image` event whose `src` is the PNG's path relative to the project root,
with the given `--caption` if any, `priority: "immediate"`, the given `--category` (default
`architektúra`) and the given `--zone` (default `both`). The event SHALL pass through the same
ingest validation as any other emit: a runtime dir outside the project root yields a path the
wall's in-project confinement rejects, and the shot is then not shown.

The command SHALL report each dropped event's reason and SHALL exit non-zero when nothing was
emitted; on success it SHALL print the URL, the project-relative path and the category.

#### Scenario: A scoped runtime dir puts the shot on the wall

- **WHEN** `wall-shot https://example.org --caption "Pricing page"` runs with the runtime dir
  under the project
- **THEN** a PNG is written under `<runtimeDir>/shots/` and an `image` event with that
  project-relative `src` and the caption is emitted to `architektúra` in zone `both`

#### Scenario: A runtime dir outside the project is refused

- **WHEN** the runtime dir lies outside the project root (for example under `/tmp`)
- **THEN** the emit rejects the image as outside the project, the reason is printed, and the
  command exits non-zero
