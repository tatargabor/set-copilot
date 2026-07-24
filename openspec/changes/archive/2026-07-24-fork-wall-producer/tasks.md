## 1. Holt kód és SDK-függőség eltávolítása

- [x] 1.1 Törölni: `src/wall/producers/graph-worker.ts` és `src/wall/producers/run-feed.ts` (a `producers/` könyvtár ezzel üressé válik)
- [x] 1.2 Törölni a `wall-feed` subcommandot a `src/cli.ts`-ből (a help-ben eddig sem szerepelt)
- [x] 1.3 `@anthropic-ai/sdk` eltávolítása a `package.json` `dependencies` közül; `npm install` és a lockfile frissítése
- [x] 1.4 Ellenőrizni, hogy a `src/index.ts` exportjai érintetlenek maradtak (`runWall`, `WallServer`, categories, types) és semmi nem hivatkozik a törölt modulokra
- [x] 1.5 `npm run build` friss `node_modules`-szal átmegy (ez ma elbukik a hiányzó SDK-n) és `npx vitest run` zöld

## 2. A rajzolási szerződés a bázis-kontextusba

- [x] 2.1 Új config szekció a rajzolási szerződésnek (kategória-registry-összefoglaló, `wall-emit` payload-alakok, render-típusok, konvenciók: mikor gráf / chart / szöveg) — a `copilot.alerts` mintájára **adat defaultokkal a `config.ts`-ben**, nem próza a skillben
- [x] 2.2 `src/copilot-prompt.ts`: a szerződés renderelése a `set-copilot prompt` kimenetébe, saját blokként (a `## Feedback` blokk mintájára)
- [x] 2.3 Unit tesztek (tiszta logika): a szerződés-blokk renderelése defaultokkal és felülírt configgal; üres/hiányzó szekció nem töri el a promptot
- [x] 2.4 Ellenőrizni, hogy egy átnevezett kategória-készlet **csak configból** végigfut a prompton — skill-fájl szerkesztése nélkül (ez a `fork-producer` „Contract is configurable" szcenárió)

## 3. A fork-producer mechanika a skillbe

- [x] 3.1 `skills/meeting-copilot/SKILL.md`: a producer-mechanika leírása — mikor indul fork, egy fork = egy slot-megbízás, a fork-prompt csak a megbízást tartalmazza, a fork `wall-emit`-tel emittál és kilép
- [x] 3.2 Rögzíteni a skillben, hogy producer forkhoz **nem adunk `model` override-ot** (a fork úgyis ignorálja) — `fork-producer` → „The fork runs on the parent's model tier"
- [x] 3.3 Rögzíteni, hogy nem indítunk várakozó/long-poll forkot, és nem indítunk forkot cache-melegen tartás céljából
- [x] 3.4 Feloldani a design nyitott kérdését: ki echóz a chatbe wall-emisszió után, a fork vagy a szülő (`copilot.acknowledge` D1 szerint minden emissziót echózni kell) — a döntést a skill mechanikájába írni

## 4. `wall-emit` robusztusság (a fork ezen az úton emittál)

- [x] 4.1 `src/wall/emit.ts`: a runtime dir létrehozása írás előtt — ma az `appendFileSync` őrizetlen, és nemlétező dir esetén elkapatlan ENOENT-tel dob, holott a docstring azt ígéri, hogy sosem crashel
- [x] 4.2 `graph` és `chart` payload minimális alaki validálása a `normalizeEvent`-ben — ma őrizetlenül castolódnak, így egy `{graph: 42}` bekerül a kanonikus logba
- [x] 4.3 Unit tesztek a fenti kettőre

## 5. Specek szinkronba hozása a megépített rendszerrel

- [x] 5.1 A `chart` render-típus javítása a `monitor-wall-display` change `display-categories` delta-specjében: `text | graph` → `text | graph | chart` (a `types.ts` `RenderType` már így van; a spec téved, nem a kód)
- [x] 5.2 Kitölteni a `openspec/specs/graph-worker` és `openspec/specs/wall-feed` „TBD - created by archiving" Purpose mezőit — archiváláskor üresen maradtak
- [x] 5.3 `openspec validate --strict` az érintett capabilityken

## 6. Mérés — a fork-modell latency- és költségprofilja

- [ ] 6.1 Megmérni és feljegyezni a fork-producer valós latencyjét: megbízás → `wall-emit` → render. Ez zárja a `wall-feedback-and-replay` 5.1-et a fork-modellre
- [ ] 6.2 Feljegyezni a fork tokenfelhasználását, külön bontva cache-read és friss input szerint; megnézni, hogyan skálázódik a session hosszával (a design fő kockázata: az örökölt prefix nő)
- [ ] 6.3 Ellenőrizni a design fő állítását: a chat *nem* áll meg, amíg egy fork rajzol (`wall-feed` → „Drawing does not stall the chat")
- [ ] 6.4 Az eredmény alapján rögzíteni a `wall-feed` „Latency budget" tényleges számait a spec helyére tett mérési hivatkozással

## 7. Böngészős verifikáció

- [ ] 7.1 Élő fork-producerrel végigmenni a `wall-feedback-and-replay` 4.1 checklistjén, emberrel a böngésző előtt, nem újraindított szerveren
- [ ] 7.2 Zone-szűrés ellenőrzése valós fork-emisszióval: privát súgás **nem** jelenik meg a `/wall` publikus ablakban
- [ ] 7.3 Párhuzamos slot-forkok ellenőrzése: két fork egyszerre emittál, mindkét slot frissül, egyik sem blokkolja a másikat

## 8. Dokumentáció

- [x] 8.1 `docs/ROADMAP.md` #6: a producer-modell rögzítése (fork, emisszió-per-igény, szekciónkénti megbízás) és a mért latency-számok
- [x] 8.2 `CLAUDE.md`: a rajzolási szerződés felvétele a config-seamek listájába (`copilot.alerts`, `detect.*`, `knowledge.keywords` mellé) — ez a „minden projekt-specifikus dolog config, nem kód" elv negyedik varrata (`copilot.drawing`)
- [x] 8.3 Feljegyezni, miért lett törölve a Haiku-worker prototípus, és mi volt a tanulsága — hogy egy későbbi iteráció ne építse újra ugyanazt (ROADMAP „Döntések logja")
