## Why

A `monitor-wall-display` change a kijelzőt és az **ingest-varratot** adja (task 3.4:
producer-agnosztikus event-source), de scriptelt fake-feeddel hajtja — a valódi tartalom
nincs rákötve. Ez a change a **valódi etetőt** építi: a live transcriptből category-tagelt
eseményeket állít elő és a wall event-source varratára push-olja. A vezérlő követelmény a
**latency**: ma a copilot kimenete azonnali, mert a fő Claude session chatjében fut; a falra
kiszervezés elkerülhetetlenül ad egy hopot, és ennek a **lehető legkevesebbnek** kell lennie.

## What Changes

- **Modalitás-szerinti, párhuzamos producerek** — nem egy monolit feed. Minden producer
  önálló, egymást nem blokkolja (nincs head-of-line blocking), és akkor tüzel, amikor a
  *saját* adata kész. Mindegyik a `monitor-wall-display` **event-source varratára** (task 3.4)
  push-ol; a szerver magját nem érinti.
- **Szöveg-út: modell-hop NÉLKÜL.** A szöveg / súgás / riasztás producer egy **vékony mjs
  loop** (vagy közvetlenül a fő session), ami a `poll` sor-offset mintáját követve olvassa a
  transcriptet és category-eseményt emittál. Nincs köztes worker-modell — a hozzáadott latency
  csak a render-hop (~10 ms). **A szöveg útjába modellt tenni tilos** (egy teljes körfordulót
  adna a semmiért).
- **Ábra-út: perzisztens, gyors gráf-worker.** Egy külön process (Haiku default, Sonnet csak
  ha a delta-minőség kikényszeríti) a *drága* vizuális modalitást hajtja: transcript →
  strukturált JSON node/edge **delta**, streamelve. A worker **stateful** — birtokolja a
  felhalmozott gráfot, ezért minimális deltát ad és nem duplázza a node-okat (inkrementális,
  Graphiti-szerű építés).
- **Gyorsasági kényszerek mint spec** (a „nagyon gyors ábra" feltételei): Haiku a default;
  egyetlen strukturált kimenet field-by-field streamelve (nincs több-körös tool-loop);
  prompt-caching a stabil prefixre (system + knowledge-context + felhalmozott gráf); perzisztens
  process memóriában tartott állapottal; push **egyenesen a hubra**, nem a fő sessionön át.
- **Grounding hot-path nélkül (hibrid vezérlés).** A gráf-worker **autonóm** figyeli a
  transcriptet, a fő session pedig csak **ritka, olcsó kontextus-tippet** ad témaváltáskor
  (kanonikus komponens-nevek a knowledge-base-ből) — nem tickenként. Így a fő session **kimarad
  a kritikus útból**, a grounding mégis megvan.
- **Immediate-prioritás megkerüli a directort.** A riasztás és a scroll-log `priority:"immediate"`,
  azonnal broadcastolódik; a director dwell/freshness pacingje **csak a vászon-swaphoz** való.
  A producer soha ne írjon közvetlenül a drótra, mindig az ingesten át — hogy a szerver-oldali
  director szinkronban tartsa a falakat.
- **`mic`/`system` és `zone` megőrizve.** A producerek a meglévő speaker-primitívet és a zóna-
  routingot fogyasztják; nincs új capture-út. A parancs-scoping `mic`-re szűkítve marad.

## Capabilities

### New Capabilities
- `wall-feed`: a producer-modell — modalitás-szerinti párhuzamos producerek, a szöveg-út
  (modell nélkül) és az ábra-út (gyors stateful gráf-worker) elhatárolása, a hibrid vezérlés
  (autonóm worker + ritka kontextus-tipp), és a latency-budget (szöveg ~10 ms, ábra 1–4 mp).
- `graph-worker`: a stateful gráf-delta worker szerződése — bemenet (transcript-span +
  felhalmozott gráf + opcionális kontextus-tipp), kimenet (JSON node/edge delta), és a
  gyorsasági kényszerek (Haiku default, single structured streamelt kimenet, prompt-caching,
  perzisztens állapot, direkt-hub push).

### Modified Capabilities
<!-- Nincs synced main spec (openspec/specs/ üres); a monitor-wall-display capabilityi még a
     testvér-change-ben élnek. Ez a change nem módosít meglévő requirementet — a becsatlakozás
     a monitor-wall-display már meglévő "Producer-agnostic event source" varratán (task 3.4)
     keresztül történik, azt nem írja át. -->

## Impact

- **Függőség:** `depends: monitor-wall-display`. A becsatlakozás a wall event-source
  interfészén (monitor-wall-display task 3.4) — a szerver magját, az SSE-t, a directort és a
  kliens-rendert **nem** érinti.
- **Új kód:** `src/wall/producers/` — a szöveg-producer (transcript → text/alert események),
  a `graph-worker` (perzisztens process, LLM-hívó loop, gráf-állapot), és a fő session
  kontextus-tipp emittálása. A mintát a meglévő `SonioxChunkClient` / `WhisperLocalClient`
  loopok adják (spawn/loop + esemény-emittálás).
- **Config-varratok** (projekt filozófia — nem kód a `src/`-ben): mely kategóriákat melyik
  producer hajtja; a gráf-worker modellje/paraméterei; a kontextus-tipp trigger (témaváltás-
  küszöb). A `detect.*` és `knowledge.*` seam-ek mintájára.
- **Új függőség:** egy Anthropic API-kliens a gráf-workerhez (Haiku). A hálózat- és
  kulcs-kezelés a meglévő Soniox-minta (env / user `.env`), nem a commitolt config.
- **Nincs érintve:** az audio → Soniox/whisper → transcript → poll lánc; a `mic`/`system`
  tagelés; a runtime-dir invariánsok.
- **Tesztelhetőség:** a tiszta logika vitest-tel — a delta-diff (mi új a gráfban),
  a kontextus-tipp trigger, az esemény-formázás; az élő latency/érzet a `wall` + a producerek
  futtatásával (a fake-feed lecserélése valódi feedre).
