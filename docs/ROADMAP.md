# Roadmap

A `set-copilot` iránya a 0.1.0 publikáció után. A pontos, kipipálható publish-teendők a [PRE-PUBLISH.md](PRE-PUBLISH.md)-ben vannak; ez a fájl a *miért* és a *mit építünk* dokumentuma.

## Vízió — miért van ez a `/voice` mellett

A Claude Code beépített diktálása (`/voice`) mikrofon-only, 20 nyelv, 2 perc limit, claude.ai-fiók kell. A `set-copilot` másért van:

- **Nyelv** — Soniox 60+ nyelv (magyar, román, horvát… a `/voice`-ban nincs).
- **Hossz** — `--max-minutes`, a csend esemény, nem leállás.
- **Auth** — saját STT-kulcs, nem kell claude.ai-fiók.
- **System audio** — a hívás *másik* oldalát is hallja. Ez a meeting-copilot létjogosultsága; a `/voice` erre elvileg képtelen.

## Platform-függetlenség — miért nincs szükség platform-integrációra

A meeting-AI-k (Otter, Fireflies, tl;dv…) **platformonként botot/API-integrációt** építenek, ami joins-per-app karbantartási taposómalom (Teams, Meet, Zoom, Webex… külön-külön). A `set-copilot` ezt **teljesen megkerüli**, mert mindkét oldala univerzális:

- **Bemenet = system audio.** Bármi, ami a gépen megszólal — nem érdekli, melyik app. BlackHole aggregate device + kész.
- **Kimenet = képernyő-megosztás.** A monitor-fal (#6) egy **böngésző-tab**, vagy akár maga a **Claude terminál** — ezt a felhasználó a meglévő meeting-appban **megosztja**. Nincs platform-specifikus kód.

→ Így **gyakorlatilag minden platform támogatott** (Teams, Meet, Zoom, Webex, Discord, sőt telefon hangszórón / személyes megbeszélés is), **nulla integrációval**. A feltétel csak annyi, hogy a meeting hangja elérje a gépet (digitális hívásnál mindig; személyesnél szoba-mikrofon). Ez egy **védhető architekturális előny** a bot-alapú versenytársakkal szemben.

## Architektúra-alapkő: `mic` vs `system` = „én" vs „mindenki más"

**Ez a package igazi motorja, és már kész + tesztelt.** A capture két streamet visz: mikrofon (én) és system/monitor (a hívás többi résztvevője). A `transcript-writer.ts` **minden JSONL sort tagel**: `speaker: "mic" | "system"`.

Ebből az egy meglévő mezőből következik a legtöbb tervezett feature — nem kell hozzá új capture:

- **„ki mondta"** — az Artifact-jegyzet eleve lehet `**Én:** … / **Ügyfél:** …` szerkezetű, ingyen.
- **parancs-scoping** — a bemondott vezérlőparancsokat `mic`-re szűkítjük, így a másik fél nem tudja átváltani a módot (az ő szövege `system`).
- **„csak én látom" vs megosztás** — a súgógép/URL sink a meglévő `speaker` mezőt fogyasztja, nem új szétválasztást.

> Tanulság: a differenciáló feature-ök nagy része **skill- vagy kis-seam-munka**, mert a drága rész (kétcsatornás capture + tagelés) már megvan.

## Feature-backlog

### 1. Ingyenes lokál STT backend (whisper) — ✅ KÉSZ (angol tesztelve)
- **Cél:** ne legyen kötelező Soniox-számla; offline is működjön. **Teljesítve.**
- **Megvalósítás:** `sttBackend: "soniox" | "whisper"` config mögött a `WhisperLocalClient` (`src/whisper-local.ts`) — a `SonioxChunkClient` mintájára bufferel, 10s-enként temp WAV-ot ír és `whisper-cli`-t (whisper.cpp) futtat, ugyanazt a `TranscriptEvent`-et emittálja. Hálózat és API-kulcs nélkül. Default modell: `ggml-small.en.bin`.
- **Engine-döntés:** whisper.cpp bináris (nem faster-whisper) — illeszkedik a meglévő spawn-binary mintához (sox/parec).
- **Streaming:** chunk-alapú maradt (mint a Soniox chunk kliens); a chunk-határon egy szó összecsúszhat — ismert tradeoff, később overlap-pal csökkenthető.
- **Teszt-eredmény (valós mikrofon, 2026-07-15):**
  - **Angol** (`small.en`): **szó szerint pontos** élő beszéden — bizonyítva.
  - **Magyar**: `base` = használhatatlan (hallucináció-hurkok); `small` (multilingual) = valódi ragozott magyar szavak, de rendes teszt még hátravan. **A magyar úthoz továbbra is a Soniox az elsődleges** (lásd döntések logja).
- **Marad:** rendes magyar minőség-teszt (több/tisztább beszéd, esetleg `medium`/`large-v3`); opcionális chunk-overlap.

### 2. Interaktív `init`
- A mostani `init` üres `.env`-et ír. Cél: prompt a backendre (Soniox/whisper), mikrofon-választás a `sources` listából, nyelv, kulcs bekérése.
- **Méret:** közepes. Nagyot javít az első élményen.

### 3. Hangvezérelt mód-váltás (részben már megoldható)
- **Cél:** menet közben, bemondásra váltható a válasz-üzemmód (pl. „copilot, súgó mód / halkíts / csak ellentmondásra szólj").
- **Állapot:** a képesség **ma is elérhető puszta skill-utasításból**, mert a skill látja, hogy egy sor `speaker:"mic"`-ből jött → az én parancsom megkülönböztethető a hívás hangjától.
- **Kis seam:** `detect.command` (a `detect.urgency`/`detect.question` mintájára) tiszta parancs-felismeréshez + hangjelzéshez; a parancsokat `mic`-re szűkítve.
- **Méret:** kicsi.

### 4. Output-sink absztrakció — hová megy a copilot kimenete
Ma az output a Claude Code chat-ablak, és csak a session gazdája látja. Konfigurálható „sink" fogalom:

| Sink | Use-case | Megvalósíthatóság |
|---|---|---|
| **chat** (jelenlegi) | alap | kész |
| **súgógép / teleprompter** — CLI `localhost` oldalt szolgál ki, élőben frissül | „csak én látom", second monitor; opcionálisan képernyő-megosztható | közepes — kis lokál web-szerver |
| **megosztható URL / Claude Artifact** | „trendi URL amit más is elér" = claude-os publik URL; harmadik féllel megosztás | jól illik — lásd lent |
| **fájl (markdown/OBS)** | streamer / „más output, nem a chat" | könnyű |

**A Claude Artifact sink:** a copilot „intelligencia" maga a Claude session, aminek van Artifact eszköze. A meeting-copilot skill **élő jegyzet-Artifactot publikálhat** (running summary + riasztások), és adott ütemben újra-deploy-olja ugyanarra az URL-re. Az Artifact alapból privát → te döntöd el a megosztást. A `speaker` mezőből eleve `Én:/Ügyfél:` szerkezet.

> ⚠️ Adatvédelem: az Artifact tartalma kimegy claude.ai-ra (cache-elődhet). Meeting-jegyzetnél rendben, de a docs-ba kell egy sor a **hívás-transzkripció / beleegyezés** jogi kérdéséről.

### 5. Válasz-módok (personák)
A mód-váltás cél-állapotai: *teljes jegyzet* · *súgó/rövid* · *csak riasztás* · *néma/log-only*. A „mit jelent egy mód" **config** (`copilot.*`), nem a skillbe drótozva.

### 6. Monitor-fal — élő, kétnézetes prezentációs felület ⭐ (nagy lehetőség)
> 📎 **Technológia + latency kutatás:** [docs/research/monitor-fal-latency.md](research/monitor-fal-latency.md) — transport, diagram-motor, LLM-pipeline, prior art, megosztás, hivatkozásokkal.

> **Állapot — a kijelző kész (scriptelt feeddel).** A `monitor-wall-display` change megépítette a
> `set-copilot wall` parancsot: lokál HTTP + SSE szerver, egyetlen megjelenítési primitív (**kategória**
> → `text`/`graph` renderer), **slot × viselkedés** modell (`scroll` / `latest(+pacing)`), config-vezérelt
> ablakok (`/` privát, `/wall` publikus) szerver-oldali **zóna-szűréssel**, a szerver-oldali **playout-director**
> (dwell/freshness/immediate-override, több fal szinkronban), **state-replay** a késve csatlakozó ablaknak, és
> egy **producer-agnosztikus event-source** (JSONL append-and-tail a runtime-dirben — ez a kanonikus log). Egy
> **scriptelt fake-feed** validálja a display-érzetet; a valódi audio/LLM etető a testvér-change
> (`wall-producers`: modalitás-szerinti producerek, szöveg modell-hop nélkül, gyors stateful Haiku gráf-worker).
> A kategóriák/ablakok/slotok mind **config/data** (`wall.*`), nem kód a `src/`-ben.
>
> _Nyitva a live előtt:_ Cytoscape jelenleg CDN-ről (offline `wall`-hoz vendored asset kell); az „A-út"
> teljes-gráf dagre-relayout ugrálásának böngészős megítélése (ha rossz → scoped „B-út"); a runtime-dir
> events-fájl tulajdon-viszonya a capture-invariánshoz képest.

> **Állapot — valós feed + D9 pivot.** A `wall-producers` change reconcile-olva: az eredeti terv egy
> **autonóm Haiku gráf-worker** köré épült, de a döntés az lett, hogy **a fő agent egy Opus 4.8 session**
> (mint a mai kézi copilot-sessionök), és **ez érti meg + emittálja** a strukturált spec-eket (szöveg +
> graph-delta + chart) a `set-copilot wall-emit` varraton át — a Haiku-worker **opcionális offloaddá** vált
> (a `wall-feed` prototípus bizonyította). A tanulság a tesztből: az autonóm Haiku grounding/szándék nélkül
> túl-gyűjt (47-node hairball emberekkel), a groundolt fő session tiszta, tömör spec-et ad. A latency
> megmarad, mert a fő session **spec-et emittál, nem rajzot** (a render ~10 ms JS a kliensen), és csak
> amikor indokolt. A `meeting-copilot` skill Phase 5-je tanítja a sessiont az emittálásra.

> **Állapot — fork-producer (a rajzoló lekerül a chat hot-pathjáról).** A `fork-wall-producer` change
> a producert a fő session **forkjává** tette (`subagent_type: "fork"`): a fork örökli a teljes
> beszélgetési kontextust (ez a grounding, ami a Haiku-workerből hiányzott), háttérben rajzol, `wall-emit`-tel
> emittál, és kilép — így a **chat nem áll meg**, amíg a fal frissül. Modell-mintázat három rétegen:
> **emisszió-per-igény** (nem long-poll, nem tickenként), **szekciónkénti szűk megbízás** (egy fork = egy slot,
> párhuzamosan indíthatók), és a rajzolási tudás (kategória-registry, `wall-emit` payload-alakok, render-típusok,
> konvenciók) a **bázis-kontextusba** kerül egyszer, cache-elve — a fork-prompt csak egy-két mondatos megbízás.
> A fork a szülő modell-tierjén fut (Opus 4.8; a `model` override-ot a fork ignorálja) — tudatosan vállalt,
> mert értelmes agenthez a Haiku kevés volt, és a fork rövid életű + túlnyomórészt cache-read a bemenete.
> A wall-út **modell-SDK-mentes** (a `@anthropic-ai/sdk`, a `graph-worker.ts`/`run-feed.ts` holt kód és a
> `wall-feed` subcommand törölve — a build friss klónon átmegy).
>
> _Mért latency-profil (élő fork-sessionökből, `wall-layout-and-box-policy` design):_ egy rajzoló fork
> **16–62 mp** és **47–76k token**; a forrást is olvasó fork a lassú vég (**42–62 mp**), a csak komponáló
> **~17 mp**, a közvetlen `wall-emit` (szöveges jegyzet, fork nélkül) **~1 mp**. Tanulság a promptolásra: egy
> pontos, szűk megbízás megspórolja a forknak a forrásolvasást — ezért éri meg a doboz-policynek pontosnak lennie.
> A `wall-feed` spec „Latency budget"-je ezért **mérésre hivatkozik**, nem a régi Haiku-becslésre (1–4 mp).

> **Állapot — spec↔kód szinkron + feedback szétbontás.** Egy adverzális audit a 7 alkalmazott
> specet a kódhoz igazította (`spec-sync-corrections`: transcript-kategória kivéve, gráf-render az
> A-path valóságra, zóna window-szintű). A `wall-feedback-and-replay` change szétbontva: a **chat↔fal
> feedback szerződés már szállítva** (`copilot.acknowledge`, `renderFeedback`), külön `wall-feedback`
> specként archiválva; a maradék a **scroll-history replay** (`wall-scroll-replay` change, még
> építendő). Két adósság ROADMAP-tétellé vált (lásd lent).
>
> _Nyitott adósságok (nem spec-driven change, hanem ROADMAP):_
> - **Böngészős verifikációs kapu** — egy ember a böngésző előtt lefuttat egy checklistet
>   (reconnect/tab-reload utáni helyes állapot; élő chart-frissítés rárendelődik; paced-swap
>   dwell/override érzet; gráf-append; zóna-szűrés `/` vs `/wall`). A headless SSE-próba ezt a réteget
>   nem fedi; ez zárja le a `monitor-wall-display` task 7.3/7.4-et.
> - **Élő latency-mérés** — modalitásonkénti valós számok (szöveg emisszió→render-hop; gráf/chart
>   spec-emisszió→render) stabil, nem-újraindított szerveren, a kutatási becslés helyett.

A #4 output-sink csúcsra járatott változata. Egy **lokál HTML fal**, amit a CLI szolgál ki, és ami:

- **Kétnézetes**: **privát** zóna (amit csak én nézek — súgás, mit mondjak, ellentmondás-riasztás, következő pont) és **publikus** zóna (amit szándékosan kifelé mutatok — megbeszélésben képernyő-megosztva vagy megosztható URL-en). A `mic`/`system` primitív eleve tudja, mi az „enyém" és mi „mindenkié".
- **Nem csak szöveg — rajzol**: amikor egy architektúráról beszélünk, a fal **élőben diagramot generál**. Élő, *növekvő* gráfhoz a [kutatás](research/monitor-fal-latency.md#2-diagram-motorok) alapján **Cytoscape.js** a helyes motor (inkrementális `cy.add()` + részleges, animált, stabil layout) — a Mermaid minden híváskor újraparse-olja és átrendezi az egészet, ezért statikus, egyszeri ábrákra való, nem élő append-re. „Oprezentál", ábrát készít menet közben — a cél a **gyorsaság**.
- **Kifelé megosztható**: vagy a publikus panel képernyő-megosztása, vagy Claude Artifact URL a távoli résztvevőknek.

**Illeszkedés:** a copilot „intelligencia" a Claude session, ami natívan tud Mermaid/SVG/HTML-t generálni; a lokál sink kiszolgálja, a `speaker` mező adja az én/ők szétválasztást, a mód-váltás (#3) állítja, mi kerül a privát vs publikus zónába.

**A nehéz rész — latency (a táblás rész, nem a szöveg).** A **szöveges elemzés már most nem lassú** — az elfogadható. A kihívás kizárólag a **diagram/tábla élő rajzolása**. A gyors út nem a „rajzoltass a fő modellel egy SVG-t" (másodpercek), hanem a *reasoning* és a *rajz-delta* szétválasztása:

- **Szétválasztás:** a fő session gondolkodik; egy **kicsi, gyors modell (Haiku)** külön hívásban csak a **gráf-deltát** húzza ki (új node-ok/élek).
- **Strukturált, nem szabadkézi:** a delta tömör **JSON node/edge lista**, amit a kliens **determinisztikusan** renderel (Mermaid vagy fix vizuális szótár: dobozok+nyilak) — nincs szabad SVG-generálás.
- **Inkrementális:** append a nulláról-újrarajzolás helyett — egy futó gráfot bővítünk.
- **Esemény-alapú + streaming:** nem minden mondatra frissítünk; a delta-tokeneket streamelve progresszíven rajzolunk.

→ Kutatási feladat: megmérni, hogy a „Haiku gráf-delta → determinisztikus render" pipeline elég gyors-e élőben. **Megvan** ([kutatás, 3. szakasz](research/monitor-fal-latency.md#3-llm-latency-pipeline)): a kis JSON-delta (~100–300 token) Haiku 4.5-tel ~1–4 mp (Gemini Flash-sel <1,5 mp), field-by-field streamelve — szemben a teljes-diagram-generálással (10+ mp). A #6 latency-kockázata **kezelhető, nem blokkoló**; a szétválasztás nem opció, hanem feltétel.

**Van hasonló?** A darabok külön léteznek, a kombináció nem:
- *Meeting-jegyzet AI-k* (Granola, Otter, Fireflies, tl;dv, Fathom) — szöveges összefoglaló, **nincs** élő diagram, nincs privát/publikus kettéosztás, nincs vetíthető vászon.
- *AI-diagram* (tldraw „Make Real", Excalidraw+AI, Napkin.ai, Mermaid AI) — de **nem** valós időben, beszédből, megbeszélés közben.
- *Interjú/teleprompter-copilotok* (pl. Cluely) — privát szöveges overlay, **nem** kétnézetes rajzoló fal.
- *Beszéd→élő diagram* (2025–2026-ban feltűnőben, de felhős + egynézetes): **Tough Tongue AI „Live Whiteboard"** (beszédre rajzol, de hosztolt, nincs privát/publikus split, nincs self-host), **Zoom AI Companion Whiteboard** (prompt-triggerelt, fizetős, felhő). Lásd a [kutatás 4. szakaszát](research/monitor-fal-latency.md#4-prior-art--versenytársak).

→ A **kétnézetes (privát+publikus), beszédből élőben rajzoló, self-hosted, saját Claude-session-nel hajtott monitor-fal** 2026-ra sem létezik termékként. Ez a package legerősebb differenciálója lehet — de a rés szűkül, érdemes haladni vele.

### 7. MCP-szerver — a kontextus gépi olvasója ⭐ (nagy lehetőség)
A #6 monitor-fal az **emberi** megosztott nézet; ez a **gépi** párja. A `set-copilot` egy **MCP-szervert** ad, amire *más AI* (az ügyfél asszisztense, vagy a saját második ügynököd) **rácsatlakozhat, kérdezhet, és megkapja a magyarázatokat**.

**Mit tenne elérhetővé (MCP resource/tool):**
- élő transcript **kurált, publikus** nézete (`speaker` szerint `Én:/Ügyfél:` — a privát rész nem megy ki),
- a knowledge-digest / -context (döntések, architektúra, definíciók),
- egy „kérdezz" tool: *„mit döntöttek X-ről?"*, *„magyarázd el a most vázolt architektúrát"* → grounded válasz a saját tudásbázisból.

**Use-case — ügyfél-megbeszélés:** az ügyfél AI-ja menet közben rákérdezhet, tisztázhat, elkérheti a magyarázatot arról, amit a csapatod bemutat — a te forrásaidból, nem hallucinálva. Vagy: a saját második ügynököd fogyasztja a kontextust, amíg a Claude session vezeti a copilotot.

**Illeszkedés:** a package már strukturált artefaktokat gyárt (`transcript.jsonl` mic/system-taggel, `knowledge-context.json`, `knowledge-digest.md`, `keyword-index.json`) — az MCP-szerver ezeket teszi ki tool/resource-ként. Az irány tiszta: `set-copilot` = MCP **szerver**, a másik AI = **kliens**.

**Kétirányú: olvasás + beküldés.** Nemcsak lekérdezni lehet, hanem **infót beküldeni** is. Az MCP alapból kliens→szerver (a szerver nem tol be kéretlenül), de a „valakinél plusz info van, beküldi" úgy oldódik meg, hogy a szerver kiad egy **`contribute` tool-t**, amit a résztvevő ügynöke meghív:
- `contribute(text, source)` → az info bekerül a meeting közös kontextusába, **tagelve, ki küldte**;
- a host Claude session látja (a transcript/context új csatornájaként), és reagálhat rá — cross-referál, felszínre hozza, kiteszi a monitor-falra (#6).

Ehhez a `speaker: "mic" | "system"` mező **általánosul `source`-ra**: `mic` (én) · `system` (hívás) · `mcp:<résztvevő>` (ügynök-beküldés). Így a meeting egy **közös kontextus-busz** lesz: emberek hanggal, ügynökök MCP tool-hívással járulnak hozzá.

**A másik irány:** ha a résztvevőnek **saját** MCP-szervere van a plusz infóval, akkor a host Claude session **kliensként** rácsatlakozik és onnan húzza — ez a normál MCP-fogyasztás, csak az ő szerverükre irányítva. (Szerver→szerver közvetlen push nincs; mindig valamelyik oldal kliensként hív.)

**Föderáció — ha mindkét fél `set-copilot`-ot futtat.** Ekkor **mindegyik példány egyszerre szerver ÉS kliens**: kiadja a saját kurált nézetét, és fogyasztja a másikét → **copilot-háló**, mindkét oldal AI-ja tudatában van a közös kontextusnak. Szimmetrikus, a per-meeting kulcsok kicserélésével. A `source` mező tovább általánosul: `mcp:peer:<név>`.
- **Vigyázat — echo/loop:** két copilot egymás beküldéseit vissza ne pörgesse; kell a `poll.ts`-ben már meglévő mic/system dedup mintája peer-szinten is (a saját `source`-t ne fogadd vissza).

**Auth — egyszerű, meeting-scoped kulcs.** A modell: a capture indulásakor generálódik egy **per-meeting token**, amit kiosztasz a résztvevőknek; az MCP-szerver ezt ellenőrzi minden híváson. Illeszkedik a meglévő invariánshoz: a runtime-dir már *per-session*, tehát a kulcs **ephemeral** — a meeting végén (a capture leáll) meghal. Ez elég is: alacsony súrlódás, revokálható (új meeting = új kulcs), és bár nem különbözteti meg a résztvevőket (mindenki a kulccsal ugyanazt a kurált nézetet látja), pont ez kell egy megbeszéléshez.

**Ami marad — scope, nem infra:**
- **csak a publikus/kurált nézet** megy ki (a #6 privát/publikus split újrahasznosul), soha a nyers privát rész;
- **transport triviális:** `ngrok`/`cloudflared` egy paranccsal ad publikus HTTPS endpointot a lokál szerverhez — a per-meeting token miatt a nyitott URL sem gond;
- ügyfélnél maradjon egy sor **beleegyezésről** a docs-ban (hívás-transzkripció megosztása).

**Hogyan tudja a másik AI, hogyan használja? Nem kell külön skill — az MCP önleíró.** Csatlakozáskor a kliens megkapja:
- **tools/list** — a tool-ok neve + leírása + input-sémája → „hogyan kérdezz" magától felderül;
- **`instructions` mező** az `initialize` válaszban → a szerver itt mondja el a magas szintű how-to-t (mit érdemes kérdezni, mikor); ez a „benne lesz, amikor csatlakozik";
- opcionálisan **MCP prompts** (kész prompt-sablonok) a gyakori kérdésekhez.

**Polling / frissülés:** két út, mindkettő a meglévő mintát követi:
- **long-poll tool** (`get_latest(since=cursor)`) — a `poll.ts` sor-offset long-pollját tükrözi; a kliens hívja, blokkol új tartalomig, kurzort ad vissza;
- **resource subscription** (`resources/subscribe` → `notifications/.../updated`) — igazi push, ha a kliens támogatja.

→ Saját Claude sessionünk a meglévő `poll` CLI-t használja; a külső MCP-kliens a fentiek egyikét. **Külön kliens-skill nem kötelező** — legfeljebb opcionális curated UX-hez, ha a másik fél is Claude Code-ot használ.

→ Ezzel a `#7` **kicsi, jól körülhatárolt build**: meglévő artefaktok + egy MCP-szerver réteg + token-check + ngrok. Az egyetlen valódi tervezési döntés: *mit tartalmazzon a kurált publikus nézet.*

**Van hasonló?** Az MCP friss (2024 vége); „élő meeting-copilot kontextus MCP-n keresztül egy másik fél ügynökének" tudtommal nincs termékként. A #6-tal együtt: **egy „publikus kontextus", két fogyasztó — ember (fal) és gép (MCP)**.

### 8. Menet közben tanítható copilot — futásidejű policy + tudás-tanulás ⭐
A #3 (hangvezérelt mód-váltás) általánosítása egy pillanatnyi mód-váltásból **tartós tanulássá**: a copilot menet közben — **bemondva vagy beírva** — utasítható, és amit tanul, azt **megjegyzi a következő meetingre is**. Nem új AI és nem új capture: a copilot *maga a Claude session*, ezért a „tanítás" a lehető legkisebb seam.

**Két külön dolgot hívunk „tanításnak", és szándékosan szét kell válniuk, mert más a perzisztálásuk:**

| Típus | Példa (bemondva/beírva) | Ma hol él | Természete |
|---|---|---|---|
| **Viselkedés-delta** | „gyakrabban szólj", „csak ellentmondásra", „max 1 sor" | `copilot.engagement` / `maxLines` / `alerts` | strukturált beállítás |
| **Tudás-delta** | „a számlázási kérdésekre a `docs/billing.md`-ben keress", „az ügyfél-döntések a Notion X oldalon vannak" | `copilot.instructions` (kézzel írt md) | szabad szöveg / forrás-pointer |

**A kulcs-belátás: a „jegyezd meg" = futásidőben írt prompt.** Mivel a copilot egy Claude session, egy megtanult utasítás nem igényel strukturált gépezetet — egyszerűen *több prompt*, pont mint a `copilot.instructions`, csak menet közben írva, nem előre. Ebből adódik a projekt filozófiájával (`minden projekt-specifikus = config, nem kód`) egyező, legkisebb dizájn.

**Új seam: `learned` overlay.** Egy markdown fájl, amit a `set-copilot prompt` a `copilot.instructions` UTÁN fűz a policy-blokkhoz (a `renderCopilotPrompt` kiterjesztése). Egyetlen új CLI-ige tölti, időbélyeges bulletekkel:

```bash
set-copilot learn "számlázási kérdésre a docs/billing.md-ben keress"
set-copilot learn --behavior "ritkábban szólj, csak ha biztos vagy"
set-copilot learn --forget <n>      # egy tanult sor törlése
set-copilot learn --list            # mit tanult eddig
```

A session indulásakor (és bármely `prompt` híváskor) beolvasódik → a **következő** meeting már örökli. Ez a réteg **pure logic, tesztelhető** — pont az a fajta, amit a CLAUDE.md szerint tesztelünk (prompt-render, fájl-append, forget-index).

**Két bemenet, egy célpont:**
- **Bemondva (hang):** a Monitor-loopban egy `mic`-re szűkített parancs-felismerés (a #3 `detect.command` seamje) kiszűri a „copilot, …" mondatot a normál transzkriptből, meghívja a `learn`-t, **röviden visszaigazol** (ez az *egyetlen* eset, ahol a rövid ack nem filler — a user tudni akarja, hogy landolt), és **azonnal alkalmazza**. A `mic`-scoping **load-bearing**: a hívás másik oldala (`system`) soha ne tudja átprogramozni a copilotot.
- **Beírva (chat):** a user szimplán megmondja a sessionnek; az a `learn`-nel perzisztálja. Nulla új gépezet.

**Azonnali vs. tartós hatás — mindkettő ingyen:** *azonnal*, mert a session LLM → amint a megtanult utasítás a kontextusában van, engedelmeskedik (nincs újraindítás); *tartósan*, mert a fájl-append a következő meetingnek is átadja.

**Döntendő — scope.** Hova írjon a `learn`? Három réteg, config-mergelve, mint minden más:
- **projekt** (`.set/copilot/learned.md`, default) — „billing itt van": projekt-specifikus tudás;
- **user-szintű** (`~/.config/set-copilot/learned.md`, `--global`) — „általában szólj kevesebbet": minden meetingre;
- **session** (nem perzisztál a `stop` után) — elsőre kihagyható, mert épp a *megjegyzés* a lényeg.
Javaslat: default projekt, `--global` a user-szintűre (tükrözi az `init --global` mintát).

**Döntendő — viselkedés-delta: szöveg vagy strukturált?** Két út:
- *(a) natúr szöveg a `learned` overlay-ben* — a session értelmezi. Egyszerűbb, nyelvfüggetlen, egy fájl mindkét típusra. **Kockázat:** a `## Engagement` blokk determinisztikusan kapuzza a loopot (silent/reactive/participant); egy overlay-mondat („ritkábban") ezzel *ütközhet* vagy fölébe kerülhet, és nem-determinisztikus lesz.
- *(b) strukturált visszaírás a config-kulcsokba* (`engagement`, `maxLines`) — determinisztikus kapuzás, de JSON-írás + a prompt újra-renderelése kell hozzá menet közben.
Javaslat: **hibrid** — a *tudás-delta* mindig szöveg-overlay; a *viselkedés-delta* a néhány ismert kulcsra (`engagement`, `maxLines`) strukturáltan írjon vissza, minden egyébre overlay. Így a talkativeness determinisztikus marad, a szabad tudás meg rugalmas.

**Illeszkedés — mi van már készen:**
- `renderCopilotPrompt` / `readInstructions` (`copilot-prompt.ts`) — az overlay-t ugyanide fűzzük, a `## Project instructions` után egy `## Learned` blokkal.
- `copilot.instructions` már bizonyítja a „projekt-tulajdonú md verbatim a promptba" mintát — a `learned` ennek futásidejű testvére.
- `mic` vs `system` tagelés (a fő primitív) adja a parancs-scoping-ot ingyen.
- A config már háromrétegű merge (default → user → projekt); a `learned` ugyanezt a rétegzést követi.

**Buktatók (tapasztalatból, hogy az OpenSpec-átvitel ne fusson bele):**
- **Ack ≠ filler.** A skill „NO FILLER. EVER." szabálya alól a tanítás-visszaigazolás **kivétel** — de csak a tanítás-parancsra, semmi másra. Ezt explicit ki kell mondani a skillben, különben a session vagy elnyeli az ack-et, vagy elkezd fecsegni.
- **A `learned.md` a runtime-dir invariánsok alá esik-e?** NEM a transcript/PID mellé való (az per-capture, egyszer átadott); a `learned.md` **tartós, több meetinget túlél**, tehát a runtime scratch dir helyett a projekt/user configdir mellé kerüljön — különben egy reboot vagy egy új session elveszti.
- **Forget/visszavonás kell.** Egy elrontott tanult sor (rossz path, félrehallott parancs) ne mérgezze örökre a promptot — innen a `--forget`/`--list`. A félrehallás valós: hangból jövő parancsnál a session olvassa vissza, mit értett, mielőtt ír.
- **Ne szivárogjon vissza a domain a kódba.** A parancs-felismerés (`detect.command`) **regex-config**, nem beégetett „copilot," szó — a #3 alatti seam, Unicode szóhatárral (`\p{L}\p{N}`, soha `\b`), hogy accentes nyelveken is működjön.
- **Több meeting, egy tanulság.** Ha `--global`, a tanult viselkedés minden projektre hat — ezt a `learn` visszaigazolásában jelezni kell („mostantól **minden** meetingen"), nehogy a user véletlenül globálisan némítsa a copilotot.

**Méret:** kicsi–közepes. A magja (`learned` overlay + `learn` ige + prompt-render + tesztek) **kicsi és önálló**, a #3 hang-felismerése nélkül is szállítható (beírt tanítással már teljes értékű). A hang-ág a #3-mal közös `detect.command` seamre épül — együtt érdemes tervezni.

**Első szelet (javasolt sorrend):**
1. `learned` overlay + `renderCopilotPrompt` kiterjesztés (pure logic + teszt),
2. `set-copilot learn` ige (`append` / `--behavior` / `--forget` / `--list` / `--global`),
3. egy bekezdés a meeting-copilot skillbe: „ha egy `mic` sor tanítás → `learn` + rövid ack + azonnali alkalmazás" (a hang-felismerés a #3-mal jön).

**Van hasonló?** A meeting-AI-k (Otter, Granola, Fireflies) *fix* beállításokkal futnak; menet közben, hangból/chatből tanuló és a tudását következő ülésre átvivő copilot — a `mic`/`system` scoping-gal védve — nincs termékként. A #5 (personák) *statikus* módjaival szemben ez a **futásidejű, tanuló** változat.

### 9. CC-natív felület-kihasználtság — kihagyott Claude Code funkciók ⭐

A copilot „intelligenciája" egy Claude Code session — így a CC saját felület-funkciói ingyen platform-képességek, amiket ma csak részben használunk ki. (Kutatás: 2026-07-24.)

**Amit már használunk** (nem cél): hookok (`.claude/settings.json` → a személyes `set-hook-*` bin-ek: `SessionStart`/`Stop`/`SubagentStop`/…), OS-szintű desktop notify (`detect … notify: true` → `notify-send`/`osascript`), fork-producer (`subagent_type: "fork"`), Monitor-alapú `poll` loop.

**Amit nem használunk ki — prioritás szerint:**

1. **Csatlakoztatott claude.ai MCP-k *fogyasztása* groundingként** ⭐ (legnagyobb nyereség). A sessionben él a **Google Calendar / Gmail / Drive** connector, de a `meeting-copilot` skill egyiket sem érinti — a copilot nem tudja, *kinek* a meetingje, kik a résztvevők, mi a linkelt napirend-doksi; csak a diktált szövegből + lokális `knowledge.sources`-ből groundol. Bekötés: a `start` fázisban lekérni az aktuális naptáresemény címét/résztvevőit + a csatolt Drive-doksit, és knowledge-kontextusként betolni. Illik a „domain-tudás = config" elvbe: egy `knowledge.adapter`, ami MCP-ből olvas. **Megkülönböztetés a #7-től:** a #7 set-copilot *mint* MCP szerver (kimenet, gépi *olvasó* felénk); ez **bemenet** (mi fogyasztunk külső MCP-t). A kettő ortogonális.
2. **Statusline** — ma nulla config. Egy `🔴 capture active · N sor · utolsó: <téma>` a CC statusline-on ambient állapotot ad anélkül, hogy a wallt kéne nézni. Van rá `statusline-setup` agent.
3. **`PushNotification` (CC cross-surface push)** — ma csak *lokális* `notify-send` van. A CC push eléri a usert akkor is, ha nincs a gép előtt — heads-down meetingnél egy urgent/question detektre ez a helyes csatorna.
4. **Hook-bővítés: árva-process takarítás** — a `SessionStart`-ot már használjuk; egy session-végi hook garantálná a `capture`+`wall` leállítását, hogy egy elfelejtett `/dd` vagy összeomló session ne hagyjon árva, még felvevő processzt / élő wall-szervert. (Ebből a `wall-stop` rész **először implementálva** — lásd lentebb.)

**Cowork-hordozhatóság.** A set-copilot *capture-szíve lokális-only*: kell **mikrofon + lokális audio-bináris** (`parec`/`sox`), lokális runtime-dir + PID-életciklus, és a wall egy **lokális HTTP+SSE szerver monitoron**. Felhős/cowork környezetben nincs mikrofon/audio-eszköz/lokál monitor → **a capture inherensen nem fut cowork-ban.** A fenti javaslatok viszont megoszlanak:

| Feature | Cowork | Miért |
|---|---|---|
| MCP grounding (Calendar/Drive) | ✅ cowork-native | claude.ai connector — ott él natívan (interaktív auth headless/cron alatt hiányozhat) |
| PushNotification | ✅ cross-surface | CC-felületek közt megy |
| Statusline | ❌ terminál-CC-only | web/cowork UI nem így rendereli |
| Hookok (`settings.json`) | ⚠️ nagyrészt lokál-CC | shell-hook a lokális gépen fut |
| Fork-producer | ✅ bárhol, ahol CC fut | harness-szintű |

**Következő lépés (ha ez a szál jön):** az **MCP-grounding adapter** — egyszerre a legnagyobb funkcionális nyereség *és* az egyetlen cowork-kompatibilis irány (sőt, ott van igazán otthon).

## Usage receptek (tervezett docs)
- **Teams / Google Meet mellett:** system audio routing (BlackHole aggregate device), privát second-monitor súgógép setup, „mikor mit lát a másik fél".
- Sink → forgatókönyv térkép: súgógép = privát; Artifact URL = megosztott jegyzet; teleprompter oldal = képernyő-megosztás.
- Beleegyezés/jogi megjegyzés a hívás-rögzítésről.

## Verzió-terv
- **0.1.0** — core diktálás + meeting copilot (Soniox), mac + linux. A modalitásokat roadmapként dokumentáljuk.
- **0.2** — headline: **Artifact-URL sink** + **hangvezérelt mód-váltás** (mindkettő inkább skill/seam), plusz **whisper** és **interaktív init**.
- **post-1.0** — Windows (WASAPI capture); backend-enkénti költség/latency összevetés.

## Döntések logja
- **Nincs npm `postinstall` hook a sox-ra** — Linuxon/CI-n/no-brew gépen törne; a `npm i -g` user nem is kapja a repo-fájlokat. Helyette: `doctor` kiírja a `brew install sox`-ot, a repót klónozóknak `Brewfile` + `brew bundle`.
- **Soniox kulcs helye:** user-szintű `~/.config/set-copilot/.env` (0600), a `.env.example` a commitolt sablon; a kulcs sosem kerül a repóba.
- **A `mic`/`system` tagelés a fő primitív** — új feature-öket erre építünk, nem új capture-re.
- **Az autonóm Haiku gráf-worker prototípus törölve — ne építsd újra.** A `wall-producers` egy külön, autonóm, kis-modellű (Haiku) workert épített, ami maga figyelte a transcriptet és húzta ki a gráf-deltát. *Mechanikusan működött*, de **grounding és szándék nélkül túl-gyűjtött**: egy 47-node-os hairballt rajzolt, mert nem tudta eldönteni, mi számít (`wall-producers` D9). A `fork-wall-producer` a kódot (`graph-worker.ts`, `run-feed.ts`, a `wall-feed` subcommand, az `@anthropic-ai/sdk` dependency) törölte. **Tanulság:** a groundingot nem lehet olcsón kívülről pótolni (context-hint) — egy fork, ami örökli a fő session kontextusát, definíció szerint viszi a megértést, egy külön kliens nem. A modell-tier is része volt a bajnak: értelmes rajzoló agenthez **minimum Sonnet** kell, a Haiku kevés. Aki legközelebb „olcsóbb külön modell a rajzhoz"-ban gondolkodik, előbb olvassa el ezt: a kód a git-történetben marad (`8fa425f`), életben tartani emlékeztetőnek nem kell.

## Nyitott kérdések
- whisper engine + streaming megközelítés?
- súgógép sink: lokál web-szerver a CLI-ben, vagy a Claude session Artifactja legyen az egyetlen „megosztható" út?
- Artifact-frissítés üteme meeting közben (percenként? esemény-alapon?).
- Monitor-fal (#6): a fő technikai kérdések **kutatva** ([docs/research/monitor-fal-latency.md](research/monitor-fal-latency.md)) — diagram-engine: **Cytoscape.js** (nem Mermaid); latency: kezelhető (kis-delta ~1–4 mp); privát/publikus: **két külön route** (`/` + `/wall`), nem két panel; transport: **SSE** (ngrok tunnel, nem Cloudflare quick tunnel, mert az nem tud SSE-t). Nyitva: a determinisztikus vizuális szótár (dobozok+nyilak) pontos formája; mikor „esemény" (endpoint/pause detektálás küszöbei).
- MCP-szerver (#7): **auth eldöntve** — per-meeting ephemeral token, ngrok/cloudflared transport. Nyitva marad: a kurált „publikus nézet" pontosan mit tartalmazzon? (transcript kurált része + knowledge-digest + „kérdezz" tool).
- Tanítható copilot (#8): a viselkedés-delta **szöveg-overlay vs. strukturált config-visszaírás** (javaslat: hibrid); a `learned.md` **scope**-ja (projekt default, `--global` user-szintre); a session-scope (nem-perzisztáló) kell-e egyáltalán.
- Windows kell-e 1.0 előtt?
