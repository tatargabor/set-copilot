# Kutatás: Monitor-fal — technológia és latency

> Ez a dokumentum a [ROADMAP.md](../ROADMAP.md) **#6 (Monitor-fal — élő, kétnézetes prezentációs felület)** és részben a **#4 (output-sink)** / **#7 (MCP-szerver)** nyitott technikai kérdéseit járja körül: milyen transport, milyen diagram-motor, milyen LLM-pipeline, és valóban akadály-e a diagram-rajzolás latency-je élőben.
>
> Készült: 2026-07-15. A megállapítások mögötti forrásokat minden szakasz végén hivatkozzuk; a teljes lista a dokumentum alján.

## Bottom line — a latency-kockázat verdiktje

**A #6 megvalósítható, és a roadmap alapötlete (kis modell → gráf-delta → determinisztikus render, esemény-alapon) helyes.** A kutatás két ponton pontosítja a roadmapet:

1. **A diagram-motor NEM a Mermaid.** A Mermaid minden híváskor újraparse-olja és teljesen újrarajzolja az egész diagramot — nincs inkrementális append, és egyetlen új node átrendezi az egész ábrát (nincs layout-stabilitás). Élő, növekvő gráfhoz a **Cytoscape.js** a helyes választás: natív `cy.add()`, csak az új részgráfra futó layout, animált átmenet. (részletek: [2. szakasz](#2-diagram-motorok))
2. **A tunnel-útnál a transport számít.** Az SSE a legegyszerűbb és elég gyors lokálban, DE a Cloudflare *quick tunnel* (`trycloudflare.com`) **nem támogat SSE-t** — ha megosztható URL kell tunnellel, akkor vagy `ngrok` (támogatja az SSE-t), vagy WebSocket. (részletek: [1.](#1-transport--a-fal-kiszolgálása) és [6. szakasz](#6-megosztás-konferencia-eszközbe))

**A latency számokban:** a *szöveges* rész (összefoglaló, riasztás) nem szűk keresztmetszet. A diagram-oldalon egy kis, strukturált JSON **delta** (~100–300 token) Claude Haiku 4.5-tel **~1–4 mp** (Gemini Flash-sel gyakran <1,5 mp), *field-by-field streamelve* — szemben azzal, ha a fő modellel rajzoltatnánk teljes SVG-t/nagy Mermaidot: **10+ mp**. Tehát a roadmapben leírt szétválasztás (fő session gondolkodik ↔ kis modell húzza a deltát) nem optimalizáció, hanem a **feltétele** annak, hogy élő legyen. Az esemény-alapú frissítés (nem minden mondatra) bevett minta a flicker és a költség ellen. (részletek: [3. szakasz](#3-llm-latency-pipeline))

## Ajánlott stack egy mondatban

| Réteg | Ajánlás | Miért |
|---|---|---|
| **Transport** | **SSE** (HTTP/2-n), két külön route: `/` privát, `/wall` publikus | Egyirányú push, ingyen auto-reconnect, legkevesebb kód egy egyprocesszes CLI-hez. Külön tab = tisztán megosztható. |
| **Diagram-motor** | **Cytoscape.js** (+ `cytoscape-dagre`/`-elk` layout) | Az egyetlen, ami inkrementális append-re + részleges, animált, stabil layoutra épül. |
| **LLM-pipeline** | Kis, gyors modell (**Haiku 4.5** / Gemini Flash) külön hívásban, **strukturált JSON node/edge delta**, streamelve; esemény-alapon | ~1–4 mp élő; a teljes-diagram-generálás (10+ mp) nem járható. |
| **Megosztás** | Elsődleges: a **publikus tab képernyő-megosztása** (Teams/Zoom/Meet mind tud egy-tab/egy-ablak share-t). Opcionális: **ngrok** URL a távoli, interaktív nézethez. | Tab-share: nulla setup a nézőnek. ngrok: crisp/interaktív, de link+auth kell. Cloudflare quick tunnel SSE-vel nem megy. |

---

## 1. Transport — a fal kiszolgálása

Egyirányú (szerver→böngésző) élő frissítéshez a **Server-Sent Events (SSE)** az egyszerűbb és jobban illő választás, mint a WebSocket. Az SSE pont erre való: a kliens egy sor (`new EventSource("/events")` + `onmessage`), és **magától újracsatlakozik** (alapból 3000 ms, a `retry:` mezővel hangolható), sőt a `Last-Event-ID` fejléccel folytatható a folyam, hogy ne játsszunk vissza kihagyott eseményeket ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)). A WebSocket full-duplex — felesleges overhead itt —, és **nincs beépített reconnect**-je, azt kézzel vagy libbel kell megoldani ([Ably](https://ably.com/blog/websockets-vs-sse)). WebSocket csak akkor kell, ha kliens→szerver üzenet vagy bináris keret is van.

**Egy valódi SSE-buktató:** HTTP/1.1 alatt a böngésző **origin-enként 6 párhuzamos kapcsolatra** korlátoz (tabok között osztva). **HTTP/2-n ez eltűnik** (multiplexelt streamek, ~100 alap) — lokálban érdemes HTTP/2-t adni, különben a nyitott `EventSource`-ok számát kell alacsonyan tartani ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).

**Latency:** lokálban/LAN-on a különbség elhanyagolható — WebSocket ~1–3 ms/üzenet, SSE ~5–10 ms, de mindkettő gyakorlatilag **egyszámjegyű–pár tíz ms** végponttól végpontig, a szerver-feldolgozás dominál, nem a drót. A falhoz mindkettő bőven <100 ms ([RxDB](https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html), [WebSocket.org](https://websocket.org/comparisons/sse/)).

**Privát vs publikus split:** a bevált minta **két külön route/oldal**, nem egy oldal két panele — pont azért, hogy a publikus nézet külön böngészőablakban/tabban éljen, amit önmagában megosztasz. Ez az OBS „windowed projector" logikája: a tiszta kimenet külön ablak, csak azt share-eled, a jegyzeteid a saját képernyőn maradnak ([OBS](https://obsproject.com/forum/threads/presenter-view-in-obs-studio.97640/), [IntelliTect](https://intellitect.com/blog/streaming-online-presentation-obs/)). Konkrétan: `/` = privát (súgás, kontrollok), `/wall` = publikus (vetítésre stílusozva); mindkettő ugyanarra az SSE-folyamra iratkozik, a szerver ugyanazokat az eseményeket tolja, minden oldal a saját zónáját rendereli.

## 2. Diagram-motorok

A #6 kulcskövetelménye: **node/edge-ek APPEND-elése egy futó gráfhoz**, teljes újrarajzolás nélkül, stabil layouttal (egy új node ne rendezze át az egészet). Ezen a szemüvegen át:

- **Mermaid.js — nem alkalmas élő append-re.** Minden `render()` friss, teljes pipeline: preprocess → újra-parse → layout → **teljesen új SVG**; szándékosan nem halmoz állapotot renderek között ([DeepWiki: rendering pipeline](https://deepwiki.com/mermaid-js/mermaid/2.2-rendering-pipeline)). Alap layout **dagre**, van újabb **ELK** (`layout: elk`) a sűrűbb gráfokra, de nehezebb ([DeepWiki: layout engines](https://deepwiki.com/mermaid-js/mermaid/2.3-layout-engines)). A layout a single-threaded DOM-on fut (szövegmérés, bounding box, él-útvonal), költsége nagyjából **O(N²)**, 50→500 node között érezhetően lassul. Konkrét panaszok: ~200–400 ms billentyű-lag egy 32 node-os diagramon ([issue #891](https://github.com/mermaid-js/mermaid-live-editor/issues/891)), Safari live-edit lag ([livebook #1846](https://github.com/livebook-dev/livebook/issues/1846)), `mmdc` CLI ~1,0 mp/diagram. Mivel az egészet újralayoutolja, **egy új node átrendezi a teljes ábrát → nincs stabilitás.**
- **Excalidraw — stabil append, de nincs auto-layout.** `updateScene` + a beta Element Skeleton API (`convertToExcalidrawElements`) engedi az inkrementális hozzáadást, a meglévők nem mozdulnak. DE kézi-rajz stílusú tábla, **nem gráf-motor: minden elemnek explicit `x`/`y` kell** — a layout a te dolgod ([Excalidraw docs](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)).
- **tldraw — ugyanaz:** `editor.createShapes` explicit koordinátán, stabil append, de **nincs beépített gráf-auto-layout**; a „Make Real" a rajzból kódot generál, ehhez nem kapcsolódik ([tldraw SDK](https://tldraw.dev/sdk-features/editor)).
- **D3 + dagre / ELK.js — globálisan csatolt.** A rétegzett (Sugiyama) layout minden menetben teljes: **egy node hozzáadása réteg-hozzárendelést és sorrendet is átírhat**. Az újabb dagre `keepNodeOrder`/`originGraph` csak a rétegen belüli sorrendet őrzi, a réteg-hozzárendelést nem — a stabilitás **részleges**, és minden append az egész gráf újraszámolása ([Svelte Flow: layouting libs](https://svelteflow.dev/learn/layouting/layouting-libraries)).
- **Cytoscape.js — erre tervezték.** `cy.add()` node/edge-et fűz a futó gráfhoz, és **`eles.layout()` csak az újonnan hozzáadott részhalmazra** futtat layoutot, nem az egészre. **Animált layout-átmenet** (`animate:true`), `cy.batch()` egy redraw-ba vonja a változásokat; hierarchikus layout a `cytoscape-dagre` és `cytoscape-elk` extension-nel ([Cytoscape.js](https://js.cytoscape.org/), [layouts blog](https://blog.js.cytoscape.org/2020/05/11/layouts/)).

**Következtetés:** élő-append + stabil/animált inkrementális layoutra a **Cytoscape.js** az egyetlen természetes választás. Az Excalidraw/tldraw stabil, de rád hagyja a teljes layoutot. A Mermaid és a D3+dagre/ELK minden változásra újralayoutol (instabil). → A roadmap #6-ban a „Mermaid natívan renderel" feltevést **Cytoscape.js-re érdemes cserélni** az élő gráfhoz; a Mermaid maradhat statikus, egyszeri ábrákhoz.

## 3. LLM-latency pipeline

**Kis/gyors modell latency (Artificial Analysis):** Claude **Haiku 4.5** ~0,6–0,9 mp time-to-first-token és **~89–94 token/mp** kimenet ([AA: Haiku 4.5](https://artificialanalysis.ai/models/claude-4-5-haiku/providers)). **Gemini 2.5 Flash** gyorsabb: ~192 t/mp, a Flash-Lite **0,37 mp TTFT** ([AA: Gemini 2.5 Flash](https://artificialanalysis.ai/models/gemini-2-5-flash)). GPT-4o-mini lassabb (~55 t/mp, ~1,47 mp TTFT). → Egy **~100–300 tokenes strukturált JSON delta** Haikun **~0,7 mp TTFT + ~1,1–3,3 mp ≈ 1–4 mp**, Gemini Flash-sel gyakran **<1,5 mp**, és az első mezők ~1 mp-en belül streamelődnek.

**Strukturált JSON kimenet:** a grammar-constrained decoding **token/token alig lassít** (<50 µs/token vs. 10–50 ms/token inferencia); az első kérésnél ~50–200 ms séma-kompiláció, aztán cache-elt. **Teljesen streamelhető** — parciális-JSON parser mezőnként renderelhet ([CalibreOS](https://www.calibreos.com/learn/genai-structured-outputs), [LMSYS](https://www.lmsys.org/blog/2024-02-05-compressed-fsm/)).

**A teljes-diagram-generálás lassú:** egy részletes SVG könnyen 1000+ token, ~90 t/mp mellett **>11 mp** — élőben használhatatlan. A token-hatékonysági irodalom szerint a **Mermaid töredék tokent** használ SVG/ASCII-hez képest (pl. 10 vs 55) — ami megerősíti, hogy **kis deltát** kell emittálni, nem az egész ábrát ([DEV: token efficiency](https://dev.to/akari_iku/analyzing-the-best-diagramming-tools-for-the-llm-age-based-on-token-efficiency-5891)).

**Inkrementális/streaming gráf-építés — bevett minta:** a „delta kihúzása + determinisztikus render" létező irány. A **Graphiti** (getzep) valós idejű tudásgráfot épít **inkrementálisan, ahogy jönnek az epizódok**, batch-újraszámolás nélkül ([Graphiti](https://github.com/getzep/graphiti)). Az **esemény-alapú frissítés elismert minta**: csak esemény-határon (szünet/endpoint) frissíts, ne minden tokenre — a re-translation irodalom dokumentálja a **stabilitás↔latency trade-offot**, ahol a minden-tokenes frissítés **flickert** okoz ([TACL](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00740/128861/), [Event-VStream](https://arxiv.org/pdf/2601.15655)).

**A szöveg NEM a szűk keresztmetszet:** az élő transzkript-összefoglaló/riasztás olcsó és gyors; a production-minta utterance-chunkokat streamel WebSocketen, folyamatosan finomított parciális összefoglalót emittál ([Picovoice](https://picovoice.ai/blog/build-real-time-meeting-summarization-tool/), [Springer](https://link.springer.com/article/10.1007/s44443-025-00304-y)). A drága lépés a *vizuális* render, nem a szöveg — pontosan ahogy a roadmap #6 feltételezi.

## 4. Prior art / versenytársak

**Meeting-jegyzet AI-k (Granola, Otter, Fireflies, tl;dv, Fathom):** mind szöveg-first — összefoglaló, action item, kereshető transzkript. **Egyik sem** rajzol diagramot a hívás közben, nincs „AI whiteboard", nincs privát/publikus split ([alfred_](https://get-alfred.ai/blog/best-ai-meeting-notetakers), [Granola blog](https://www.granola.ai/blog/meeting-note-tool-pricing-granola-vs-fireflies-fathom-otter)).

**AI-diagram eszközök (tldraw Make Real, Excalidraw AI, Napkin.ai, Mermaid AI):** on-demand *szöveg/rajz → diagram*, **nem beszédből, nem élőben** — mindegyikhez ember gépel/beilleszt és kattint ([Make Real](https://makereal.tldraw.com/), [Excalidraw text-to-diagram](https://www.geeky-gadgets.com/ai-diagram-creation-tool-excalidraw/)).

**Interjú/teleprompter copilotok (Cluely és klónjai):** privát, valós idejű **szöveges** overlay a viselőnek — coaching próza, **nem kétnézetes rajzoló vászon**, semmit nem rajzol. (Cluely: 2025-ös adatszivárgás ~83 000 user transzkriptjével — releváns a self-hosted/adatvédelmi érv mellett) ([Interview Sidekick](https://interviewsidekick.com/blog/cluely-review), [OpenCluely](https://opencluely.techycsr.dev/)).

**A legközelebbi valódi egyezés — beszéd→élő diagram — 2025–2026-ban feltűnőben, de csak felhős csomagokban:**
- **Tough Tongue AI „Live Whiteboard"** beszédre „azonnal rajzolni kezd" folyamatábrát/org chartot/topológiát — a legközelebbi analóg, de **hosztolt, dokumentált privát/publikus split és self-hosting nélkül** ([Auto Interview AI](https://www.autointerviewai.com/blog/ai-meeting-notetaker-whiteboard-visual-ai-tough-tongue-2026)).
- **Zoom AI Companion Whiteboard** (2026 márciusi frissítés) promptból generál diagramot, és transzkriptet strukturált táblává alakít — de **prompt-triggerelt, fizetős, felhő-only, egynézetes** ([Zoom](https://www.zoom.com/en/products/online-whiteboard/features/ai-whiteboard/)).
- **MockFlow IdeaBoard for Google Meet:** *gépelt* promptból ábra a meetingben — nem folyamatos beszéd, felhő ([MockFlow](https://mockflow.com/whiteboard-for-google-meet/)).

**Következtetés:** a teljes kombináció — **kétnézetes (privát + publikus), folyamatosan beszéd-vezérelt, élőben rajzoló, self-hosted** fal — **2026-ra sem létezik termékként**. A darabok külön léteznek (beszéd→diagram: Tough Tongue/részben Zoom; privát overlay: Cluely; szöveg→diagram: Excalidraw/Mermaid), de minden valós idejű beszéd→diagram ajánlat **felhős és egynézetes**. A #6 differenciálója áll — de a rés szűkül, érdemes haladni vele.

## 5. Megosztás konferencia-eszközbe

**A út — csak a fal tabját/ablakát oszd meg (videó-út).** Mindhárom platform enged egyetlen felület-megosztást, így a többi ablak privát marad:
- **Google Meet:** „A tab" / „A window" / „Entire screen"; egy Chrome-tab megosztása a legdiszkrétebb, a tab-audio alapból megy. 2025 dec.-től rendszerhang ablak/teljes képernyő megosztásnál is (macOS 14.2+/Win11+, Chrome 142+) ([Meet Help](https://support.google.com/meet/answer/9308856)).
- **Zoom:** konkrét alkalmazás-ablak választható; csak az látszik, bármit is váltasz. (Linux/Wayland: csak teljes desktop — Xorg alatt megy az egy-ablak) ([Zoom](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060596)).
- **Teams:** *Share > Window* (egy program) vs *Share > Screen*; a 2024-es presenter-window a résztvevőket ráteszi, az értesítéseket középre viszi, hogy ne kerüljenek a képbe ([Teams](https://support.microsoft.com/en-us/teams/meetings/present-content-in-microsoft-teams-meetings), [M365 Insider](https://techcommunity.microsoft.com/blog/microsoft365insiderblog/teams-enhancements-to-the-presenter-window-while-screensharing/4225408)).

Latency/minőség: a képernyő-megosztás videóként újrakódolva megy, a platform saját latency-jével (jellemzően sub-second–~1–2 mp), és a finom szöveg/detail lágyulhat a tömörítéstől. Nézőnek nulla setup, de nem pixel-crisp és nem interaktív.

**B út — publikus URL tunnel (direkt út).** A résztvevő a saját böngészőjében nyitja a falat:
- **ngrok:** `ngrok http 3000` → publikus HTTPS URL TLS-sel, lokál inspektor `127.0.0.1:4040`-en ([ngrok](https://ngrok.com/docs/guides/share-localhost/overview)).
- **Cloudflare quick tunnel:** `cloudflared tunnel --url http://localhost:8000` → random `*.trycloudflare.com` URL, fiók nélkül — **de teszt-grade: ~200 párhuzamos kérés limit, NINCS SSE-támogatás, nincs SLA** ([Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)).

> ⚠️ **Fontos a transport-választással összefüggésben:** ha SSE-t választunk (1. szakasz) ÉS megosztható URL-t tunnellel, akkor a Cloudflare quick tunnel kiesik (nincs SSE) — **ngrok**-ot használjunk, vagy a tunnel-út kedvéért WebSocketet. A képernyő-megosztásos útnál (A) ez nem gond, mert ott a böngésző lokálisan pollozik/streamel, csak a videó megy ki.

Trade-off: a direkt URL crisp és interaktív (mindenki lokálisan rendereli, közel nulla vizuális latency), de linket kell küldeni és saját auth kell (a #7 per-meeting tokenje pont erre való). A képernyő-megosztás linktelen, de a platform videó-minőségét/latency-jét örökli.

---

## Hatás a roadmapre (#6)

- **Diagram-engine döntés:** a nyitott „Mermaid vs tldraw/Excalidraw" kérdésre a válasz élő gráfhoz **Cytoscape.js** (a Mermaid nem append-el, instabil). Ez a #6 „Mermaid natívan renderel" sorát felülírja.
- **Latency-verdikt:** az esemény-alapú, inkrementális, kis-delta pipeline **elég gyors** (~1–4 mp) — a #6 nyitott kockázata **kezelhető**, nem blokkoló.
- **Transport:** SSE + két route a legkisebb kód; a tunnel-útnál ngrok (nem Cloudflare quick tunnel).
- **Prior art:** két új, közeli (de felhős, egynézetes) szereplő — Tough Tongue AI, Zoom AI Whiteboard; a self-hosted kétnézetes rés áll, de szűkül.

## Források

**Transport**
- [Using server-sent events — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [WebSockets vs Server-Sent Events — Ably](https://ably.com/blog/websockets-vs-sse)
- [WebSockets vs SSE vs Long-Polling vs WebRTC vs WebTransport — RxDB](https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html)
- [WebSocket vs SSE — WebSocket.org](https://websocket.org/comparisons/sse/)
- [Presenter View / Windowed Projector — OBS Forums](https://obsproject.com/forum/threads/presenter-view-in-obs-studio.97640/)
- [Streaming an online presentation with OBS — IntelliTect](https://intellitect.com/blog/streaming-online-presentation-obs/)

**Diagram-motorok**
- [Rendering Pipeline — mermaid (DeepWiki)](https://deepwiki.com/mermaid-js/mermaid/2.2-rendering-pipeline)
- [Layout Engines — mermaid (DeepWiki)](https://deepwiki.com/mermaid-js/mermaid/2.3-layout-engines)
- [Poor Performance and Bad Alignment — mermaid-live-editor #891](https://github.com/mermaid-js/mermaid-live-editor/issues/891)
- [Slow Mermaid rendering on Safari — livebook #1846](https://github.com/livebook-dev/livebook/issues/1846)
- [Excalidraw Element Skeleton API — docs](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton)
- [excalidrawAPI (updateScene) — docs](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)
- [tldraw SDK — Editor / createShapes](https://tldraw.dev/sdk-features/editor)
- [Make Real — tldraw](https://makereal.tldraw.com/)
- [dagre-d3 — GitHub](https://github.com/dagrejs/dagre-d3)
- [dagrejs (keepNodeOrder / originGraph) — npm](https://www.npmjs.com/package/dagrejs)
- [Layouting libraries (Dagre vs ELK.js) — Svelte Flow](https://svelteflow.dev/learn/layouting/layouting-libraries)
- [Cytoscape.js — hivatalos](https://js.cytoscape.org/)
- [Using layouts — Cytoscape.js blog](https://blog.js.cytoscape.org/2020/05/11/layouts/)
- [cytoscape.js-dagre](https://github.com/cytoscape/cytoscape.js-dagre) · [cytoscape.js-elk](https://github.com/cytoscape/cytoscape.js-elk)

**LLM-latency**
- [Claude 4.5 Haiku — Artificial Analysis](https://artificialanalysis.ai/models/claude-4-5-haiku/providers)
- [Gemini 2.5 Flash — Artificial Analysis](https://artificialanalysis.ai/models/gemini-2-5-flash)
- [GPT-4o mini — Artificial Analysis](https://artificialanalysis.ai/models/gpt-4o-mini)
- [Structured Outputs: Grammar-Constrained Decoding — CalibreOS](https://www.calibreos.com/learn/genai-structured-outputs)
- [Fast JSON Decoding with Compressed FSM — LMSYS](https://www.lmsys.org/blog/2024-02-05-compressed-fsm/)
- [Diagramming Tools for the LLM Age: Token Efficiency — DEV](https://dev.to/akari_iku/analyzing-the-best-diagramming-tools-for-the-llm-age-based-on-token-efficiency-5891)
- [Graphiti: Real-Time Knowledge Graphs — GitHub](https://github.com/getzep/graphiti)
- [How "Real" is Your Real-Time Simultaneous Speech Translation — TACL](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00740/128861/)
- [Event-VStream: Event-Driven Real-Time Understanding — arXiv](https://arxiv.org/pdf/2601.15655)
- [Dynamic agenda-aware real-time meeting summarization — Springer](https://link.springer.com/article/10.1007/s44443-025-00304-y)
- [Build a Real-Time Meeting Summarization Tool — Picovoice](https://picovoice.ai/blog/build-real-time-meeting-summarization-tool/)

**Prior art**
- [Best AI Meeting Notetakers 2026 — alfred_](https://get-alfred.ai/blog/best-ai-meeting-notetakers)
- [Meeting note tool pricing — Granola](https://www.granola.ai/blog/meeting-note-tool-pricing-granola-vs-fireflies-fathom-otter)
- [Tough Tongue AI Live Whiteboard — Auto Interview AI](https://www.autointerviewai.com/blog/ai-meeting-notetaker-whiteboard-visual-ai-tough-tongue-2026)
- [Zoom AI Whiteboard — Zoom](https://www.zoom.com/en/products/online-whiteboard/features/ai-whiteboard/)
- [IdeaBoard for Google Meet — MockFlow](https://mockflow.com/whiteboard-for-google-meet/)
- [Cluely Review 2026 — Interview Sidekick](https://interviewsidekick.com/blog/cluely-review)
- [OpenCluely](https://opencluely.techycsr.dev/)
- [Excalidraw text-to-diagram — Geeky Gadgets](https://www.geeky-gadgets.com/ai-diagram-creation-tool-excalidraw/)

**Megosztás**
- [Present during a video meeting — Google Meet Help](https://support.google.com/meet/answer/9308856)
- [Sharing your screen or desktop on Zoom](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060596)
- [Present content in Microsoft Teams meetings](https://support.microsoft.com/en-us/teams/meetings/present-content-in-microsoft-teams-meetings)
- [Teams presenter window enhancements — M365 Insider](https://techcommunity.microsoft.com/blog/microsoft365insiderblog/teams-enhancements-to-the-presenter-window-while-screensharing/4225408)
- [Share Localhost — ngrok](https://ngrok.com/docs/guides/share-localhost/overview)
- [Quick Tunnels — Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
