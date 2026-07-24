## Context

set-copilot ma egy fej nélküli (headless) lánc: audio → Soniox → `transcript.jsonl` →
`poll` → Claude session. A copilot „intelligencia" maga a session; nincs szerver és nincs
UI. A ROADMAP #6 (Monitor-fal) ezt egészíti ki egy **lokál, kétnézetes prezentációs
kijelzővel**. A [latency-kutatás](../../../docs/research/monitor-fal-latency.md) a
technikai kockázatokat már eldöntötte: SSE transport, Cytoscape.js diagram-motor,
kis-modell (Haiku) strukturált JSON gráf-delta pipeline.

Ez a change **kizárólag a kijelzőt és annak megjelenítési modelljét** építi meg, egy
scriptelt fake-feeddel — hogy a modell *érzetét* validáljuk, mielőtt a valódi audio/LLM
rákötődne. A tervezés egy explore-menetből kristályosodott ki, ahol több UI-ötlet (privát
súgás, folyó transzkript, élő rajz, felgörgő képek, paced váltás) fokozatosan **egyetlen
primitívvé** olvadt össze.

## Goals / Non-Goals

**Goals:**
- Egyetlen megjelenítési primitív — a **kategória** —, amiből minden (szöveg és rajz)
  egységesen származik.
- **Slot-alapú, deklaratív layout**, dinamikusan összerakható, natív-gyors substraten.
- A `scroll` / `latest(+pacing)` viselkedés-szótár, ami a render-típussal (`text`/`graph`)
  ortogonális 2×2-ben lefedi az összes megjelenítési igényt.
- **SSE + szerver-oldali playout**, több nézet URL-en, `zones`-szűrővel, state-replay-jel.
- Scriptelt fake-feed a display-feel validálásához, audio/LLM nélkül.
- Illeszkedés a projekt filozófiájához: kategória/slot/routing = config/data, nem kód a `src/`-ben.

**Non-Goals (későbbi lépcső):**
- Valódi audio → Soniox → transcript → wall kötés; a valódi **Haiku gráf-delta pipeline**.
- **Futásidejű** dinamikus kategória add/remove és teljes md/mjs **plugin-hot-reload** (ROADMAP #8).
- Megosztható **tunnel** (ngrok) integráció; most a publikus tab képernyő-megosztása az alap.
- Per-kategória **egyedi mjs renderer** betöltése — most a beépített `text`/`graph` renderer elég;
  a séma előkészíti, de a betöltő nem épül meg.
- Perzisztencia / felvétel / visszajátszás a session után.

## Decisions

### D1 — Egy primitív: a kategória (nem külön „szöveg" és „grafika")

A megjelenítés atomja a kategória: `{ id, label, icon, render: text|graph, source? }`. Az
esemény csak egy `category` címkét hordoz + payloadot; a display a jelentésről semmit nem
tud, pusztán a regiszterből oldja fel, mit és hogyan rajzoljon.
**Miért:** ez a `copilot.alerts` (taxonómia-data) + `detect.*` (detektor) +
`knowledge.adapter` (deklaratív vs kódos modul) varratok általánosítása — nem új mintát
vezet be, hanem a meglévőt terjeszti ki.
**Alternatíva (elvetve):** külön szöveg- és grafika-alrendszer. Két kódút, duplázott
routing, és a „a rajz is csak egy csatorna" felismerés elveszne.

### D2 — Slot × viselkedés, a render-típussal ortogonálisan (a 2×2)

A layout slotok kompozíciója: `slot = { area, behavior, cats[] , pacing? }`. Viselkedés:
`scroll` (halmoz, görög) vagy `latest` (csak a legújabb). A render-típus (`text`/`graph`)
a kategóriáé. A kettő ortogonális:

```
                scroll                    latest (+ pacing)
  text    transzkript-log            kitűzött súgás / riasztás
  graph   filmstrip (felgörgő képek) élő vászon (playout-rendező)
```

**Miért:** minden explore-ötlet egy-egy cella lett — a modell *generatív*, nem ad hoc. A
„kitűzött doboz" és a „paced vászon" nem külön mechanizmus: mindkettő `latest`, csak pacing
nélkül vagy pacinggel.
**Alternatíva (elvetve):** hardkódolt panelek (egy súgás-doboz, egy transzkript-log, egy
vászon). Merev, nem bővíthető, nem magyarázza a kombinációkat.

### D3 — Substrate: vanilla + CSS Grid, framework nélkül; Cytoscape csak a graph-hoz

A CSS Grid *maga* a layout-motor: a slot-lista → `grid-template-areas`, slotonként egy
`<div>`. A viselkedések ~20 soros vanilla renderer-függvények. Az egyetlen külső lib a
Cytoscape.js (+`cytoscape-dagre`), és csak a `graph` render-típushoz.
**Miért gyors, szerkezetileg:** SSE push (nincs poll); 1 esemény = 1 slot DOM-mutáció
(sose renderelünk újra egész oldalt); a Grid reflow natív; a `latest+pacing` visszafogja a
drága dagre-layoutot (a paced-swap maga a flicker/CPU-védelem).
**Alternatíva (elvetve):** React/Vue — build-tooling + runtime startup, a „gyors+egyszerű,
CLI által kiszolgált lokál oldal" ellen dolgozik.

### D4 — Diagram-motor: Cytoscape.js (a kutatás felülírja a ROADMAP eredeti Mermaidját)

Élő, növekvő gráfhoz `cy.add()` a futó gráfra + részleges, animált, stabil layout. A
Mermaid minden híváskor újraparse-ol és átrendez → statikus, egyszeri ábrákra való.
**A POC szándékos „A-út" választása:** először a dagre-t a *teljes* gráfra futtatjuk
`animate:true`-val — hogy *lássuk*, ugrál-e egy 10–15 node-os gráfon. Ha elviselhetetlen,
a „B-út" (layout csak a delta-részhalmazra, meglévők lockolva) a következő lépés. A POC
célja pont ezt a döntést adatolni.

### D5 — Transport: SSE + szerver-oldali playout

Egy `/events` SSE-broadcast; a böngésző natív auto-reconnectje ingyen jön. A playout-
ütemezés (dwell/freshness/override) **a szerveren** authoritatív, hogy több fal szinkronban
legyen és a direkt „váltts ábrát" parancs egy helyről propagáljon. State-replay a
csatlakozáskor: az új kliens megkapja az aktuális gráf-állapotot + a kitűzött latest-eket.
**Alternatíva (elvetve):** WebSocket — full-duplex overhead, nincs beépített reconnect;
felesleges, amíg nincs kliens→szerver csatorna. Kliens-oldali playout — a falak elcsúsznának.

### D6 — Séma: category-tagelt, jelentés-agnosztikus esemény

```jsonc
{ "category":"riasztás",     "zone":"private", "text":"⚠ ellentmondás", "priority":"immediate" }
{ "category":"transzkript",  "zone":"public",  "text":"...", "speaker":"system" }
{ "category":"architektúra", "zone":"public",  "visual":"v1", "graph":{ "op":"add", "nodes":[…], "edges":[…] } }
{ "category":"architektúra", "zone":"public",  "visual":"v2", "graph":{ "op":"reset" } }   // témaváltás → új vizuál
{ "kind":"show", "cat":"architektúra", "id":"v2", "priority":"immediate" }   // director-parancs
```

A graph-események egy `visual` id-t hordoznak; az azonos id-jű delták egy vizuálhoz
append-elődnek. Egy `op:"reset"` (új `visual` id-vel) **témahatár**: a jelenlegi vászon-
vizuál befagy és *jelöltté* válik, egy friss vizuál kezd épülni. Így a paced director
**vizuálok között** swappol (min-dwell/freshness), nem egy végtelenül növő gráfon belül.

**Miért:** ez a display↔producer szerződés, ami a fake-feed lecserélése után is megmarad.
A `zone` a routing, a `category` a render, a `speaker` a megőrzött mic/system primitív. Az
opcionális `priority:"immediate"` mező egy *bejövő* eseményen (nem csak director-parancson)
azt jelenti: a szerver azonnal broadcastolja, a pacinget megkerülve — pacing csak a paced
vászon-swapra. Ez a mező a testvér-`wall-producers` change kimenetéből érkezik (riasztás,
scroll-log), így a fake-feed és a valódi feed byte-kompatibilis marad.

### D7 — Ablakok és event-source: mindkettő config/absztrakció, nem beégetve

**Ablakok:** a nézetek teljesen configból jönnek — `name`, `route` (URL), `zones`-szűrő
és slot-layout mind egy `wall.windows[]` config-lista elemei. A `/` és `/wall` csak
default; új ablak = új config-bejegyzés, nulla kód. **Miért:** ez a „minden
projekt-specifikus = config" elv, és a routingot (melyik falon mi látszik) a felhasználó
állítja, nem a `src/`.

**Event-source:** a szerver az eseményeit egy **event-source absztrakcióból** kapja, nem
egyetlen beégetett producerből. Több párhuzamos producer is tölthet ugyanabba a broadcast-
streambe; a szerver kategória/zóna szerint merge-el és szór, függetlenül attól, ki emittált.
A scriptelt fake-feed *egy* ilyen source. **Miért:** külön (készülő) change arról szól, hogy
a csoportokat **kategóriánként külön subagentek** etetik párhuzamosan — ez az absztrakció a
becsatlakozási pont, hogy a két change tisztán komponálódjon. Ez a change az *ingest-varratot*
adja meg (a fake-feed rajta keresztül tölt), a valódi multi-producer ingest a testvér-change.

**Ingest-transport = JSONL append-and-tail** (a capture → `transcript.jsonl` → `poll` minta):
a process-en kívüli producerek egy runtime-dir-beli events-fájlhoz fűznek category-tagelt
JSON sorokat, a szerver tail-eli. **Miért ez, nem HTTP/socket:** a projekt már így oldja a
cross-process határt, illik a runtime-dir invariánsokba, és **a fájl a kanonikus esemény-log**
— ezzel megszűnik a „kié a canonical gráf késői csatlakozásnál" nyitott kérdés: a szerver a
fájlból replayel, a graph-worker memóriája csak a minimális delta számításához kell, nem
forrás-igazság. Újraindításnál az állapot a fájlból újraépíthető.
**Alternatíva (elvetve):** a fake-feedet közvetlenül a broadcastba drótozni — akkor a
párhuzamos-producer change-nek át kéne írnia a szerver magját.

### D8 — Kód-elhelyezés

Új `src/wall/`: `server.ts` (HTTP + SSE + state), `director.ts` (playout policy),
`feed-script.ts` (fake-feed), és `src/wall/public/` (statikus `index.html`, `wall.js`,
`wall.css`). Új `wall` alparancs a `cli.ts`-ben. A kategória-regiszter, a slot-layout és a
window-routing **config/data** (a `config.ts` seam-jei mellé), nem beégetve. A tiszta
logika (kategória-feloldás, slot→grid leképezés, playout dwell/freshness/override) vitest-tel
fedve; a render/érzet `set-copilot wall` futtatásával.

## Risks / Trade-offs

- **[A-út layout ugrálhat]** A teljes-gráf dagre-újralayout egy nagyobb gráfon rondán
  átrendezhet. → *Mitigáció:* a POC pont ezt méri; ha rossz, B-út (scoped layout). A kis
  demo-gráf + animáció miatt kis méretben valószínűleg elviselhető.
- **[Cytoscape mint új függőség]** CDN vs vendored, offline működés. → *Mitigáció:* POC-ban
  CDN a leggyorsabb; a csomagolás (vendored asset a `public/`-ba) a live-iteráció előtt
  eldöntendő, hogy a `wall` internet nélkül is menjen.
- **[HTTP/1.1 SSE 6-kapcsolat/origin limit]** Sok tab esetén korlát. → *Mitigáció:* pár
  ablak esetén nem gond; ha szükséges, HTTP/2 lokálban feloldja.
- **[Scope-kúszás a plugin-rendszer felé]** A kategória-vízió futásidejű add/remove-ig hív.
  → *Mitigáció:* ez a change kőbe vési a határt: a kategóriák **indításkor** töltődnek
  (config/module), a futásidejű mutáció és a hot-reload #8, nem ide tartozik.
- **[A fake-feed hazudhat a valódi latencyről]** A scriptelt idővonal nem a valódi
  Haiku-válaszidő. → *Mitigáció:* a fake-feed a *display* érzetét validálja (paced-swap,
  scroll vs latest, gráf-append), nem az LLM-latencyt — azt a kutatás már megmérte.

## Open Questions

- **Layout-config formátuma és helye:** külön config-szekció (`wall.windows[]`) vagy önálló
  fájl? A kategória-regiszter inline config vagy `categories.mjs` modul már az első körben?
  (Explore-hajlam: külön `categories.mjs`, hogy a „kategóriát fájlban adok meg" élmény
  rögtön meglegyen.)
- **State-replay granularitása:** csak a gráf-állapot + kitűzött latest-ek, vagy a scroll-
  logok utolsó N sora is visszajátszódjon a késve csatlakozó ablaknak?
- **Cross-fade a `latest+pacing`-nél:** az első körben elég a kemény vágás, vagy már most
  fade-transition kell az „érzethez"?
- **Cytoscape csomagolás:** CDN a POC-hoz, de a live előtt vendored asset kell-e az
  offline `wall`-hoz?
