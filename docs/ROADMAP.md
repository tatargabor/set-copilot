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

### 1. Ingyenes lokál STT backend (whisper)
- **Cél:** ne legyen kötelező Soniox-számla; offline is működjön.
- **Illeszkedés:** a `soniox-rt.ts` már `TranscriptEvent`-et emittál, és van `SonioxRtClient` + `SonioxChunkClient`. Egy `WhisperClient` ugyanezt az eventet adná, `sttBackend: "soniox" | "whisper"` config mögött.
- **Döntendő:** engine (whisper.cpp bináris vs faster-whisper); real-time streaming (whisper chunk-alapú → latency/minőség tradeoff); modell-letöltés/tárolás kezelése.
- **Méret:** nagy. Ez a legnagyobb önálló dev-tétel.

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
A #4 output-sink csúcsra járatott változata. Egy **lokál HTML fal**, amit a CLI szolgál ki, és ami:

- **Kétnézetes**: **privát** zóna (amit csak én nézek — súgás, mit mondjak, ellentmondás-riasztás, következő pont) és **publikus** zóna (amit szándékosan kifelé mutatok — megbeszélésben képernyő-megosztva vagy megosztható URL-en). A `mic`/`system` primitív eleve tudja, mi az „enyém" és mi „mindenkié".
- **Nem csak szöveg — rajzol**: amikor egy architektúráról beszélünk, a fal **élőben diagramot generál** (Mermaid natívan renderel; nehezebb esetre tldraw/Excalidraw-stílus, SVG). „Oprezentál", ábrát készít menet közben — a cél a **gyorsaság**.
- **Kifelé megosztható**: vagy a publikus panel képernyő-megosztása, vagy Claude Artifact URL a távoli résztvevőknek.

**Illeszkedés:** a copilot „intelligencia" a Claude session, ami natívan tud Mermaid/SVG/HTML-t generálni; a lokál sink kiszolgálja, a `speaker` mező adja az én/ők szétválasztást, a mód-váltás (#3) állítja, mi kerül a privát vs publikus zónába.

**A nehéz rész — latency (a táblás rész, nem a szöveg).** A **szöveges elemzés már most nem lassú** — az elfogadható. A kihívás kizárólag a **diagram/tábla élő rajzolása**. A gyors út nem a „rajzoltass a fő modellel egy SVG-t" (másodpercek), hanem a *reasoning* és a *rajz-delta* szétválasztása:

- **Szétválasztás:** a fő session gondolkodik; egy **kicsi, gyors modell (Haiku)** külön hívásban csak a **gráf-deltát** húzza ki (új node-ok/élek).
- **Strukturált, nem szabadkézi:** a delta tömör **JSON node/edge lista**, amit a kliens **determinisztikusan** renderel (Mermaid vagy fix vizuális szótár: dobozok+nyilak) — nincs szabad SVG-generálás.
- **Inkrementális:** append a nulláról-újrarajzolás helyett — egy futó gráfot bővítünk.
- **Esemény-alapú + streaming:** nem minden mondatra frissítünk; a delta-tokeneket streamelve progresszíven rajzolunk.

→ Kutatási feladat: megmérni, hogy a „Haiku gráf-delta → determinisztikus render" pipeline elég gyors-e élőben. Ez a #6 nyitott technikai kockázata.

**Van hasonló?** A darabok külön léteznek, a kombináció nem:
- *Meeting-jegyzet AI-k* (Granola, Otter, Fireflies, tl;dv, Fathom) — szöveges összefoglaló, **nincs** élő diagram, nincs privát/publikus kettéosztás, nincs vetíthető vászon.
- *AI-diagram* (tldraw „Make Real", Excalidraw+AI, Napkin.ai, Mermaid AI) — de **nem** valós időben, beszédből, megbeszélés közben.
- *Interjú/teleprompter-copilotok* (pl. Cluely) — privát szöveges overlay, **nem** kétnézetes rajzoló fal.

→ A **kétnézetes (privát+publikus), beszédből élőben rajzoló, self-hosted, saját Claude-session-nel hajtott monitor-fal** tudtommal nem létezik termékként. Ez a package legerősebb differenciálója lehet.

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

## Nyitott kérdések
- whisper engine + streaming megközelítés?
- súgógép sink: lokál web-szerver a CLI-ben, vagy a Claude session Artifactja legyen az egyetlen „megosztható" út?
- Artifact-frissítés üteme meeting közben (percenként? esemény-alapon?).
- Monitor-fal (#6): diagram-engine (Mermaid vs tldraw/Excalidraw)? A latency mekkora akadály — elég-e az esemény-alapú, inkrementális rajzolás? A privát/publikus zóna külön oldal vagy egy oldal két panele?
- MCP-szerver (#7): **auth eldöntve** — per-meeting ephemeral token, ngrok/cloudflared transport. Nyitva marad: a kurált „publikus nézet" pontosan mit tartalmazzon? (transcript kurált része + knowledge-digest + „kérdezz" tool).
- Windows kell-e 1.0 előtt?
