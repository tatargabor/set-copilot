# wall-presentation Specification

## Purpose
Dress a wall window for an audience — a shared screen or a projector — through
`wall.presentation`: title bar, chrome language, hidden operator input, theme, type scale, box
headings, ticker bands, overflow auto-scroll, a full-screen canvas and tabs over every visual
the canvas received. Presentation changes how a window looks to its viewer; it never decides
which content reaches which zone — zones and the server-side redactor remain the only content
controls.

## Requirements
### Requirement: Presentation is chrome only, never a content control

`wall.presentation` SHALL change only how a window looks: its title bar, the language of the
wall's own labels, whether the operator input is shown, its theme, its type scale, box
headings, ticker bands and auto-scroll. It SHALL NOT change which events reach which zone or
window, what the redactor scrubs or withholds, or what is replayed to a joining client. The
setting SHALL be handed to the browser in the window bootstrap and applied there; the server
SHALL NOT consult it when routing, redacting or accumulating events.

The motivation is a wall shown to a client on a shared screen: "make it presentable" must
never be the same edit as "show more to the audience". That second decision belongs to zones
and the audience declaration (`public-redaction`).

#### Scenario: A presentation change does not widen what the public wall receives

- **WHEN** a project sets `wall.presentation` with a title, `theme: "studio"` and tickers on a
  public window
- **THEN** that window receives exactly the events, redacted exactly as, it received before
  the change

#### Scenario: Labels change, content does not

- **WHEN** `wall.presentation.locale` is `"en"`
- **THEN** the wall's own chrome (channel labels, status strip, reset and send buttons, input
  placeholder) is shown in English, and every event's text is shown unchanged

### Requirement: Presentation fields resolve one by one with a fallback

Each `wall.presentation` field SHALL be resolved independently, and an invalid value SHALL fall
back to that field's default without failing the config load or affecting the other fields:

- `title`, `subtitle`: a non-blank string, trimmed; otherwise absent (no title bar).
- `locale`: `"en"`, otherwise `"hu"`.
- `hideInput`: only an explicit `true` hides the input; otherwise `false`.
- `theme`: `"studio"` or `"studio-dark"`, otherwise `"default"`.
- `scale`: a number from 0.75 to 2 inclusive, otherwise `1`.
- `boxTitles`: an object; only entries whose value is a non-blank string are kept.
- `tickers`: an object; only entries whose value is `"marquee"` or `"rotate"` are kept.
- `autoScroll`: only an explicit `false` turns it off; otherwise `true`.

With no `wall.presentation` at all, the wall SHALL look as it did before the feature existed:
Hungarian chrome, input visible, default theme, scale 1, no title bar.

#### Scenario: An out-of-range scale falls back alone

- **WHEN** `wall.presentation` is `{ "title": "Kickoff", "scale": 3, "theme": "neon" }`
- **THEN** the title bar shows `Kickoff`, the scale is `1` and the theme is `"default"`, and
  the wall starts normally

#### Scenario: A malformed ticker entry is dropped, the valid one kept

- **WHEN** `tickers` is `{ "agenda": "marquee", "notes": "slide" }`
- **THEN** the `agenda` position is shown as a marquee band and `notes` is shown as an ordinary
  box

### Requirement: Title bar, hidden input, theme and scale

When a `title` is set, the window SHALL show a title bar above the grid carrying the title and,
when set, the `subtitle`; the browser tab title SHALL be the presentation title. Without a
title, no title bar SHALL be shown.

When `hideInput` is `true`, the operator input box SHALL NOT be rendered, because on a shared
screen whatever the operator types there is visible to the audience.

The `studio` theme SHALL render dark in any OS colour scheme (a shared screen does not follow
the viewer's preference). `studio-dark` SHALL be the studio layout with a toned-down near-black
palette, and SHALL also style the transcript page (`wall-transcript-page`). `scale` SHALL
multiply the studio themes' type and spacing and the presentation chrome (title bar, box
headings); under the `default` theme the dense dashboard body is not rescaled.

#### Scenario: Hidden input on a shared screen

- **WHEN** `hideInput` is `true`
- **THEN** the status strip shows no message box and no send button

#### Scenario: Studio stays dark on a light-mode machine

- **WHEN** a wall with `theme: "studio"` is opened in a browser whose OS prefers a light scheme
- **THEN** the wall renders with the studio dark palette

### Requirement: Box headings per position

`boxTitles` SHALL map a box position name to a heading shown at the top of that position's box.
A heading SHALL be presentation of the position, not content: it SHALL NOT depend on, or alter,
what the box receives.

#### Scenario: A pinned box gets a heading

- **WHEN** `boxTitles` is `{ "kitűzött": "Decisions · Open questions" }`
- **THEN** the box at position `kitűzött` shows the heading `Decisions · Open questions`, and
  boxes at other positions show none

### Requirement: Ticker bands reuse the rendered text, never re-parsed markup

A box position named in `tickers` SHALL show its latest `text` event as a band instead of a
block: each innermost list item, paragraph or heading of the rendered text becomes one ticker
item. `marquee` SHALL scroll the items continuously as a seamless loop; `rotate` SHALL show one
item at a time and cross-fade to the next every few seconds (when there is more than one).

The items SHALL be copies of the nodes the text renderer already built, never markup parsed a
second time — the band is only a way of displaying an ordinary text event, so redaction and
zones apply to it exactly as to any other box. A ticker box SHALL NOT also auto-scroll.

#### Scenario: An agenda becomes a rotating band

- **WHEN** a box at a position configured as `rotate` receives a text event holding a
  three-item list
- **THEN** the box shows one item at a time, cycling through all three, and each item's
  formatting is the text renderer's own

#### Scenario: A text event with no items leaves the box as rendered

- **WHEN** a ticker box receives a text event whose rendering contains no non-empty list item,
  paragraph or heading
- **THEN** the box keeps the ordinary rendering rather than showing an empty band

### Requirement: Overflowing reference boxes scroll themselves, with a per-viewer toggle

A box with `latest` behavior, no pacing and no ticker mode SHALL, while its content is taller
than the box, scroll itself slowly down and back up again, resting at each end. It SHALL NOT
move while the pointer is over the box (the viewer is reading), and SHALL resume from where the
viewer left it.

Each such box SHALL carry its own on/off toggle, shown only while the content overflows. The
toggle's state SHALL be remembered per viewer, per window route and box position, in the
viewer's browser; with nothing remembered, `autoScroll` decides the initial state. A failure to
read or write that browser storage SHALL leave the default in force rather than break the box.

#### Scenario: A long agenda glides on its own

- **WHEN** a `latest` agenda box's content overflows and nobody is pointing at it
- **THEN** it scrolls to the bottom, rests, and scrolls back to the top, repeatedly

#### Scenario: One viewer's toggle does not affect another

- **WHEN** a viewer switches auto-scroll off for a box and reloads the page
- **THEN** that box stays off for that viewer, while another viewer's wall still scrolls it

### Requirement: The canvas can take the whole wall

Every paced box (the canvas) SHALL carry a full-screen toggle. Full screen SHALL be enterable
with the toggle or the `F` key and left with the toggle, `F` or `Esc`; only one box SHALL be
full screen at a time. Keystrokes typed into an input field, or made with a modifier key, SHALL
NOT trigger it. Full screen SHALL be viewer-side only: the other boxes SHALL keep receiving and
rendering content underneath.

#### Scenario: F and Esc

- **WHEN** a viewer presses `F` on a wall with a paced canvas, and later presses `Esc`
- **THEN** the canvas fills the wall, and then returns to its place in the grid

#### Scenario: Typing does not toggle

- **WHEN** the operator types the letter `f` in the wall's message box
- **THEN** the canvas does not change size

### Requirement: Canvas tabs over every visual, following the conversation by default

A graph box SHALL keep every graph visual it has received, in arrival order, and when it holds
at least two SHALL show a tab per visual, labelled with the visual's `title` or else its
`visual` id, plus an `Auto` tab. By default the box SHALL follow the server's pick (the
director's `show`). Selecting a tab, or paging with `←`/`→`, SHALL take manual control; `Auto`
(or the `A` key) SHALL hand control back and show the server's current pick. While under manual
control, a new server pick SHALL NOT change what is shown; it SHALL only be marked on its tab.
Keyboard paging SHALL apply to the most recently created graph box and SHALL ignore keystrokes
typed into an input field or made with a modifier.

#### Scenario: Paging back during a live meeting

- **WHEN** the canvas holds visuals `v1`, `v2`, `v3`, shows `v3`, and a viewer presses `←`
- **THEN** `v2` is shown, and a subsequent server pick of `v4` is marked on its tab without
  replacing `v2` until the viewer selects `Auto`

#### Scenario: A single visual shows no tabs

- **WHEN** a graph box has received only one visual
- **THEN** no tab strip is shown

### Requirement: Reconnect replays every visual with its title

On a client's (re)connect, for each paced category with a currently shown visual, the server
SHALL replay that category's other visuals first, unshown, then the shown visual followed by its
`show` command, so the reloading client rebuilds its tab strip in arrival order. Each replayed
visual SHALL carry its accumulated `title`. The replay SHALL use the zone-appropriate
accumulation slice and the same visual-id redaction guard as live delivery, so a public client
receives the scrubbed title of the public slice, and no visual whose id matches a redaction
pattern.

#### Scenario: A reload keeps the tabs

- **WHEN** a viewer reloads a wall whose canvas has received three titled visuals
- **THEN** the canvas shows the same three tabs with their titles, and the shown visual is the
  one the server is showing

#### Scenario: A public reload gets the scrubbed title

- **WHEN** a visual's title contained a redaction-matching token and a public client reloads
- **THEN** its tab shows the scrubbed title, never the original
