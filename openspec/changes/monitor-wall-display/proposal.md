## Why

ROADMAP #6 (Monitor-fal) a package legerősebb differenciálója: egy lokál, kétnézetes
prezentációs kijelző, ahol a copilot élőben súg (privát) és rajzol (publikus). A
[kutatás](../../../docs/research/monitor-fal-latency.md) a technikai kockázatokat már
tisztázta (SSE + Cytoscape + kis-modell delta-pipeline). Ami hiányzik, az a **kijelző
maga** és annak a modellje — és ezt előbb *érzetre* validálni kell, mielőtt a valódi
audio/LLM pipeline rákötődne. Ez a change a kijelzőt építi meg egy szimulált (scriptelt)
eseményfolyammal, hogy a megjelenítési modell — kategória → slot → viselkedés — bizonyíthatóan
koherens és jó legyen, még a live integráció előtt.

## What Changes

- **Új `set-copilot wall` parancs**: egy lokál HTTP-szervert indít, ami statikus
  HTML/CSS/JS kijelzőt és egy SSE `/events` streamet szolgál ki. Nincs framework;
  a substrate vanilla + CSS Grid, az egyetlen külső lib a Cytoscape.js (graph render).
- **Kategória mint egyetlen megjelenítési primitív**: a súgás, riasztás, transzkript
  ÉS a vizuális rajzok mind *kategóriák* — id/label/ikon + render-típus (`text` | `graph`)
  + alap-routing. Deklaratív kategória = config/md; kódos kategória (saját renderer/detektor)
  = mjs modul, a meglévő `knowledge.adapter` mintát követve. Ez a `copilot.alerts` /
  `detect.*` / `knowledge.adapter` varratok általánosítása — nem átírás.
- **Slot-alapú, dinamikusan építhető layout**: a kijelző slotok deklaratív kompozíciója.
  Slot = { area, viselkedés, feliratkozott kategóriák }. Viselkedés-szótár: `scroll`
  (halmoz, görög) és `latest` (csak a legújabb), utóbbi opcionális *pacinggel* (min-dwell,
  frissesség-kapu, prio-override, cross-fade) — ez a vászon playout-rendezője. A
  render-típus × viselkedés ortogonális 2×2 lefedi az összes megjelenítési igényt.
- **Több nézet, routinggal — teljesen configból**: az ablakok listája config; minden ablak
  deklarálja a `name`-jét, a `route`-ját (URL), a `zones`-szűrőjét (`private` | `public` |
  `both`) és a slot-layoutját. A `/` és `/wall` csak default; új ablak = új config-bejegyzés,
  kód nélkül. A meglévő `mic`/`system` speaker-primitív adja az „én" vs „mindenki más" szétválasztást.
- **Producer-agnosztikus event-source**: a szerver az eseményeket egy absztrakcióból kapja,
  nem egyetlen beégetett producerből — több párhuzamos producer is tölthet ugyanabba a
  streambe. A fake-feed egy ilyen source; a becsatlakozási pont készen áll a testvér-change-nek.
- **SSE transport szerver-oldali playout-rendezővel**: egy `/events` broadcast-stream,
  state-replay-jel új kliensre (menet közben bekapcsolt fal a jelenlegi állapotot kapja),
  a playout-ütemezés a szerveren, hogy több fal szinkronban legyen.
- **Scriptelt fake-feed** a display-feel validálásához (nincs még audio/Soniox/LLM kötés).

Nem cél most (későbbi lépcső, ROADMAP #8 territóriuma): futásidejű dinamikus
kategória add/remove, md/mjs plugin-betöltő, és a valódi Haiku gráf-delta pipeline
integrációja. A séma és a kategória-regiszter felülete viszont már ezt előkészíti.

## Capabilities

### New Capabilities
- `display-categories`: a kategória-primitív és a category-tagelt esemény-séma —
  kategória-definíció (id, label, ikon, render-típus, forrás), a display↔producer szerződés.
- `display-layout`: a kliens megjelenítési modell — slotok, viselkedések
  (`scroll` / `latest` + pacing), render-típusok (`text`, `graph` Cytoscape-pel),
  CSS Grid substrate, a slot-config → grid-template leképezés.
- `wall-server`: a `set-copilot wall` parancs — lokál HTTP-szerver, SSE `/events`
  broadcast + state-replay, több nézet URL-en `zones`-szűrővel, szerver-oldali playout-rendező.

### Modified Capabilities
<!-- Nincs — nincsenek meglévő OpenSpec specek; minden capability új. -->

## Impact

- **Új kód**: `src/wall/` (szerver, SSE, playout-rendező), `src/wall/public/`
  (statikus HTML/CSS/JS kijelző + kategória/slot renderer), új `wall` alparancs a
  `cli.ts`-ben, és egy scriptelt fake-feed dev-harness.
- **Config-varratok** (a projekt filozófiája szerint, nem kód a `src/`-ben):
  kategória-regiszter, slot-layout és window-routing mind config/data.
- **Új függőség**: Cytoscape.js (+ `cytoscape-dagre`) — a POC-ban CDN-ről; a csomagolás
  eldöntendő (CDN vs vendored) a design-ban.
- **Nincs érintve**: az audio → Soniox → transcript → poll lánc változatlan; a `wall`
  ebben az iterációban független, scriptelt feeddel fut.
- **Testvér-change (készülő)**: a kategóriánként külön subagentekkel, párhuzamosan etetett
  event-stream külön change lesz; ez a change csak az *ingest-varratot* (event-source
  absztrakció) adja meg, hogy az tisztán rákötődjön — a multi-producer maga nem itt épül.
- **Tesztelhetőség**: a tiszta logika (kategória-feloldás, slot→grid leképezés, playout
  policy: dwell/freshness/override) vitest-tel fedhető; a render/érzet a `wall` futtatásával.
