# Wall — switching one canvas between diagram and chart: four rough edges

Found 2026-10-08 while capturing real wall screens for a product video: the board was fed a
scripted event sequence (`wall --no-fake-feed` + `wall-emit`, invented data, headless Chrome,
studio-dark theme, planning layout) and screenshotted after each step. The product claim being
filmed is the one `src/wall/types.ts` already makes: a single presentation box can show „a
diagram, then a chart, then an image, without the box or the layout being redefined”, and the
visual's title is „shown on the canvas tab strip”.

The switch works. These four things got in the way, and each needed a workaround in the
capture script. Observed at `1e91785`.

## 1. The tab strip disappears while a chart is on the canvas (P1)

The tab strip belongs to the diagram renderer (`makeGraphSlot`, `renderTabs` in
`src/wall/public/wall.js`), and it shows only from two diagrams up. When a chart lands on the
same canvas, the strip is gone; it comes back with the next diagram. So the viewer cannot see
that the chart is one of several visuals on the same canvas, which is exactly what the
`types.ts` comment promises.

**Accept when:** every visual on a canvas slot (graph, chart, image, webpage) gets a tab with
its title; the strip stays while a chart is shown; the lit tab is the visual on screen.

## 2. Page open shows the first diagram, not the director's current choice (P2)

Two diagrams arrived before the page opened; the director had picked the newest. On connect
the replay painted the **first** diagram. Workaround in the capture: open the page before the
diagrams arrive, so they land live.

**Accept when:** a freshly opened wall shows the same visual on each canvas slot as a wall
that was open all along (replay honours the director's last swap).

## 3. Re-showing the last diagram after a chart gives an empty canvas (P1)

After diagram → chart, asking for the diagram that was on the canvas before the chart left the
canvas blank. Workaround: re-send that diagram as a reset, so the director offers it again.

**Accept when:** diagram A → chart → diagram A repaints A without a reset, with its tab lit.

## 4. Chart value labels run into the bars (P2)

On a single-series bar chart with values in the thousands, the value labels overlap the bar
ends at the wall's planning-layout size. Readable on a laptop, not at video or projector
distance.

**Accept when:** value labels never overlap their bar (outside the bar end, or inside with
contrast), at the smallest planning-layout canvas size.

## Reproduce

Any scripted sequence of: two `graph` events → open the page → a `chart` event on the same
slot → the earlier `graph` again. A deterministic driver (config, event list, Chrome over the
DevTools protocol, PNG per step) exists in a private promo repo and can be copied here as a
`scenarios/` replay if wanted.
