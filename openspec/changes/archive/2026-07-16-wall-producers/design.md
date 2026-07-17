## Context

A `monitor-wall-display` change megépíti a kijelzőt (SSE-szerver, kategória/slot modell,
szerver-oldali director) és a **producer-agnosztikus event-source varratot** (task 3.4), de
scriptelt fake-feeddel hajtja. Ez a change a fake-feed helyére a **valódi etetőt** teszi.

A vezérlő kényszer a **latency**. Ma a copilot kimenete azonnali, mert a fő Claude session
chatjében fut, és a felhasználó menet közben látja. A falra kiszervezés hozzáad egy hopot; a
tervezés egésze arról szól, hogy ez a hop a lehető legkisebb legyen — modalitásonként külön
kezelve, mert a szöveg és az ábra latency-profilja gyökeresen más.

A gondolatmenet egy explore-menetből kristályosodott ki, ahol tisztázódott: (1) a megjelenítő
oldal már longpollozik+frissül (SSE+böngésző, LLM nélkül); (2) az LLM a *producer* oldalra
való; (3) a „subagent vs loop" a lényeget tekintve konvergál, ha ráteszed a gyorsasági
kényszereket; (4) a szöveg útjába **tilos** modellt tenni.

## Goals / Non-Goals

**Goals:**
- Modalitás-szerinti **párhuzamos producerek**, head-of-line blocking nélkül, a meglévő
  event-source varratra kötve (a szerver magját nem érintve).
- **Szöveg-út modell-hop nélkül** — a hozzáadott latency csak a render-hop (~10 ms).
- **Ábra-út gyors, stateful gráf-worker** — 1–4 mp/delta, inkrementális append.
- A „nagyon gyors ábra" **gyorsasági kényszereinek** rögzítése (Haiku, single structured
  streamelt kimenet, prompt-caching, perzisztens állapot, direkt-hub push).
- **Hibrid vezérlés:** autonóm worker + ritka kontextus-tipp — grounding a hot-path nélkül.
- A `speaker`/`zone` primitívek és a runtime-dir invariánsok megőrzése.

**Non-Goals:**
- A kijelző, az SSE, a director, a kliens-render bármely része (az a `monitor-wall-display`).
- Futásidejű dinamikus kategória add/remove és plugin-hot-reload (ROADMAP #8).
- Több gráf-worker flotta orkesztrációja elsőre — az MVP egy gráf-worker (lásd D5).
- Az A-út vs B-út Cytoscape-layout döntés — az a display change POC-jában dől el.
- Megosztható tunnel (ngrok) / MCP (ROADMAP #7).

## Decisions

### D1 — Producer = vékony process a modalitáshoz, NEM Claude Code subagent

Az etetőt modalitásonként egy-egy **önálló process/loop** hajtja, ami a meglévő
`SonioxChunkClient` / `WhisperLocalClient` mintáját követi (loop → API/olvasás →
esemény-emittálás). Egy `transcript → JSON delta` átalakítás **egyetlen strukturált
modellhívás**, nem ágens-munka; a Claude Code subagent tool-loop overheadje és szórása pont
a latency ellen dolgozna.
**Miért:** a párhuzamosságot a *N darab független process* adja, nem az, hogy mi van a
dobozban; adott modellhez a vékony loop gyorsabb és kiszámíthatóbb, mint a subagent.
**Alternatíva (elvetve):** per-tick spawn-olt, több-körös, tool-használó subagent a fő
sessionön át — a leglassabb forma; a fő session serializálná és a saját turn-latencyjét adná.
**Konvergencia:** ha a subagentet egyetlen strukturált kimenetre kényszeríted (nincs
tool-loop), az ~ egy modellhívás vékony kerettel — a *forma* számít, nem a címke (lásd D3).

### D2 — Szöveg-út: modell-hop NÉLKÜL

A szöveg / súgás / riasztás producer egy vékony loop (vagy közvetlenül a fő session), ami a
`poll` sor-offsetjével olvassa a transcriptet és category-eseményt emittál. Nincs köztes
worker-modell.
**Miért:** a fal „plusz ideje" a szövegnél *csak* a hub→SSE→render hop (~5–15 ms lokálban); egy
worker-modell a szöveg útjában egy teljes körfordulót (~1–3 s) adna a semmiért — szigorúan
rosszabb a mai azonnali kimenetnél.
**Alternatíva (elvetve):** minden modalitást egy összefoglaló-modellen átvezetni — egységes,
de a szöveget ok nélkül lelassítja.

### D3 — Ábra-út: a „nagyon gyors" hat kényszere

A gráf-worker az egyetlen hely, ahol modell a hot-pathon van; ezért kap hat konkrét kényszert,
amelyek együtt adják az 1–4 mp-et:
1. **Haiku default** (Sonnet csak ha a delta-minőség kikényszeríti);
2. **egyetlen strukturált kimenet**, field-by-field streamelve (nincs több-körös tool-loop);
3. **prompt-caching** a stabil prefixre (system + knowledge-context + felhalmozott gráf);
4. **perzisztens process**, gráf-állapot memóriában (nincs újra-passzolás tickenként);
5. **push egyenesen a hubra**, nem a fő sessionön át;
6. **inkrementális `cy.add()`** a kliensen (a display change adja) — a worker csak deltát ad.
**Miért:** ezek mind külön latency-karok; az elhagyásuk (teljes gráf újra-emittálása,
tool-loop, cache-eletlen prefix, fő-sessionön át) a mérhető lassulás forrása.

### D4 — Stateful gráf-worker (a delta a workeré, nem a fő sessioné)

A worker **birtokolja a felhalmozott gráfot**, tudja mi van már kirajzolva, ezért minimális
deltát ad és nem duplázza a node-okat (Graphiti-szerű inkrementális építés).
**Miért:** ez az egyetlen igazi indok a *dedikált, tartós* workerre (szemben a stateless
per-esemény hívással): a minimális delta = kisebb token = gyorsabb + olcsóbb + stabilabb
layout.
**Alternatíva (elvetve):** stateless hívás, ami minden tickre megkapja a teljes gráfot — nagyobb
prompt, nagyobb delta, node-duplázás kockázata.

### D5 — Hibrid vezérlés: autonóm worker + ritka kontextus-tipp

A gráf-worker **maga figyeli a transcriptet** (a fő session nincs a per-tick kritikus úton), a
fő session pedig **témaváltáskor** ad egy olcsó **kontextus-tippet** (kanonikus komponens-nevek
a knowledge-base-ből), amit a worker egyszer fogyaszt el.
**Miért:** a tiszta autonóm út a leggyorsabb, de elveszti a grounding-ot; a tiszta
direktíva-út grounded, de a fő sessiont a hot-pathra teszi. A hibrid a kettő legjava: gyors ÉS
grounded.
**Alternatívák (elvetve):** (a) tisztán autonóm — nincs grounding, rossz komponens-nevek;
(b) fő session tickenként spawn-ol — serializálódik, a fő session a szűk hely.

### D6 — Immediate-prioritás megkerüli a directort

A `riasztás` és a `scroll`-log `priority:"immediate"` — a szerver azonnal broadcastolja; a
director dwell/freshness pacingje **csak a vászon-swaphoz** való. A producer soha nem ír
közvetlenül a drótra, mindig az event-source ingesten át.
**Miért:** ha a director dwell-időt tartana egy alerten, az pont a kerülendő késleltetés; az
ingesten-át-mindig szabály tartja szinkronban a több falat.

### D7 — MVP: egy gráf-worker, nem flotta

Az első szelet: **fő session (szöveget közvetlenül emittálja) + EGY perzisztens gráf-worker
(Haiku).** A worker-per-kategória flotta a skálázott verzió, később.
**Miért:** a kutatás szerint a modell-szétválasztás *feltétel* az élőhöz — de csak a gráf
modalitásnál; előbb az egy stateful workert kell bizonyítani, mielőtt orkesztrációt építünk rá.

### D8 — Kód-elhelyezés és config-varratok

Új `src/wall/producers/`: `text-producer.ts` (transcript → text/alert események),
`graph-worker.ts` (perzisztens LLM-loop + gráf-állapot), `context-hints.ts` (a fő session
témaváltás-tippje). Az Anthropic-kliens a gráf-workerhez a Soniox-minta szerint kezeli a
kulcsot (env / user `.env`, sosem a commitolt config). **Config/data** (nem kód a `src/`-ben):
mely kategóriát melyik producer hajtja, a worker modellje/paraméterei, a kontextus-tipp
trigger-küszöbe — a `detect.*` / `knowledge.*` seam-ek mintájára. A tiszta logika (delta-diff,
tipp-trigger, esemény-formázás) vitest-tel fedve; az élő latency/érzet a `wall` + producerek
futtatásával.

### D9 — A fő Opus session AZ extractor/emitter; a Haiku-worker opcionális offload (felülírja D1/D3/D5/D7 hangsúlyát)

A megvalósítás közben megszületett döntés: **a fő agent egy Opus 4.8 session — pontosan úgy,
ahogy a mai kézi copilot-sessionök futnak.** Ez a session már *érti* a beszélgetést (ő futtatja
a meeting-copilotot) és *groundolt* (nála van a knowledge-base + a beszélgetés-történet). Ezért a
vizuális modalitás **megértését is a fő session végzi**, és a strukturált spec-et (graph-delta,
chart) **közvetlenül emittálja** a wall JSONL-varratára — nem egy külön, autonóm modell.

A `subagent` / renderer ezután **buta**: szövegnél egy JavaScriptes kiírás (D2, változatlan),
ábránál a fő session által megadott spec determinisztikus rajzolása (a display már ezt csinálja).

**Miért (a teszt bizonyítéka):** az autonóm Haiku-worker prototípus (D3/D4, `wall-feed`) *mechanikusan*
működött — valódi gráf + tökéletes revenue-chart —, **de grounding és szándék nélkül túl-gyűjtött**:
egy 47-node-os hairball lett belőle, emberekkel és mellékszálakkal node-ként. A tanulság: a megértést
a **groundolt, már a loopban lévő intelligens agentnek** kell adnia; egy külön fast-tier modell újra-
levezetve rosszabb.

**Latency megőrzése (amit D3 jól látott):** a fő session **tömör strukturált spec-et** emittál
(`{nodes,edges}` / `{chart}` — kis JSON), **nem rajzot** (az SVG-generálás lenne a 10 mp), és **csak
amikor indokolt** (nem tickenként). A render a kliensen ~10 ms JS marad. Ugyanabban a turnben, amiben
a súgást adja, a fő session mellé teszi a vizuál-spec-et — **egy megértés, több kimenet**, nem két
modell, ami ellentmondhat.

**A Haiku-worker sorsa (D3/D4 megmarad, de demótálva):** nem törlődik — **opcionális offload** marad
(`wall-feed`), arra az esetre, ha a fő session túl elfoglalt, vagy ha *sok párhuzamos stream/tab* lesz
(a felhasználó „az összes tabot subagentekkel figyeli" képe). De ekkor is a fő session adja a tartalmat
a subagentnek; a megértés akkor is az Opusé.

**A seam (D8 kiegészítése):** a fő session a `set-copilot wall-emit` CLI-n tolja a byte-kompatibilis
`DisplayEvent`-et a `<runtimeDir>/wall-events.jsonl` varratra — ugyanaz a JSONL append-and-tail, amit a
fake-feed és a `wall-feed` használ. A „producer" a fő session; a CLI a keze.

**D5 (hibrid kontextus-tipp) sorsa:** tárgytalanná válik a fő út mentén — a fő session *maga* a
grounding-forrás, nincs kinek tippet küldenie. A kontextus-tipp csak akkor él újra, ha a Haiku-offloadot
(D3/D4) használjuk skálázáskor.

## Risks / Trade-offs

- **[A fő session mégis a hot-pathra kerül]** Ha a kontextus-tipp túl gyakori, a D5 hibrid
  elcsúszik a lassú direktíva-út felé. → *Mitigáció:* a tipp trigger-küszöbe config; a worker
  tipp nélkül is termel (autonóm alap).
- **[Haiku delta-minőség gyenge lehet]** Rossz vagy zajos node/edge-ek egy komplex témán. →
  *Mitigáció:* Sonnet opt-in a config-ban (D3/1); a delta-diff teszt kiszűri a duplázást; a
  kontextus-tipp javítja a neveket.
- **[Prompt-cache a felhalmozott gráffal]** A növekvő gráf-prefix hosszabbodik, a cache-hit
  romolhat. → *Mitigáció:* a stabil/volatile határ tudatos elrendezése; nagy gráfnál a prefix
  tömörítése (csak a releváns szomszédság) egy későbbi kar.
- **[Két producer ugyanarra a kategóriára ír]** Verseny a state-ért. → *Mitigáció:* egy
  kategóriát pontosan egy producer birtokol (a config ezt kényszeríti ki).
- **[A fake-feed és a valódi feed eltér]** A séma-drift megtörné a display-t. → *Mitigáció:* a
  producer-kimenet byte-kompatibilis a fake-feeddel (a `monitor-wall-display` D6 szerződése);
  a fake-feed marad regressziós referencia.

## Migration Plan

1. `depends: monitor-wall-display` — előbb a display change (event-source varrat, task 3.4) áll.
2. Text-producer bekötése az event-source-ra; a fake-feed szöveg-ága kiváltva, a display
   változatlanul renderel (byte-kompatibilis esemény).
3. Egy gráf-worker (Haiku) bekötése; a fake-feed gráf-ága kiváltva.
4. Kontextus-tipp (D5) hozzáadása a fő session oldalán; méréssel igazolni, hogy a worker
   autonóm alapja tipp nélkül is termel.
5. Rollback: a producereket kikapcsolva a fake-feed visszaáll (ugyanaz az event-source varrat),
   a display érintetlen.

## Open Questions

**Feloldva a D9 pivottal:**
- **~~Szöveg-producer: fő session vs külön mjs loop~~** → **a fő session emittál** (`wall-emit`),
  nincs külön szöveg-loop. Kiterjesztve: nemcsak a szöveget, a graph/chart spec-et is a fő session adja.
- **~~A kontextus-tipp trigger~~** → **tárgytalan a fő úton** (D5 descoped): a fő session maga a
  grounding-forrás. Csak a Haiku-offload skálázásakor éled újra.
- **~~Delta-diff hol authoritatív~~** → a fő úton a **fő session** birtokolja a `visual`-állapotot
  (ő dönti el a `reset`/`add`-et); az offload úton a `graph-worker` memóriája (változatlan D4).

**Nyitva marad (az offload úthoz, ha aktiváljuk):**
- **Modell-kliens megosztása:** a Haiku-offload Anthropic-kulcsa a Soniox-kulcs mellé a user
  `.env`-be; kell-e külön modell-provider absztrakció (Gemini Flash mint alternatíva)?

**Consent / privacy:** a fő úton (D9) a transcript **nem megy külön modellhez** — a fő session
már látja azt. Csak az **opcionális Haiku-offload** (`wall-feed`) küld transcript-tartalmat az
Anthropic API-nak; azt a felhasználó explicit engedélyéhez kötjük (a prototípusnál megtörtént).
