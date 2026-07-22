## Why

A `wall-producers` change D9 döntése kivette a rendszerből az autonóm producert, mert a Haiku-worker prototípus *grounding és szándék nélkül túl-gyűjtött* (47-node-os hairball). A megoldás az lett, hogy a fő Opus session maga emittál — ezzel viszont a producer visszakerült a chat hot-pathjára, és a fal csak addig él, amíg én menet közben ráérek rajzolni.

Van egy harmadik út, ami mindkét bajt megszünteti: a **fork** (`subagent_type: "fork"`). Örökli a fő session teljes kontextusát — tehát ugyanazt a groundingot és szándékot viszi, ami a chatben van, nem kell neki kitalálnia, mi fontos —, közben mellékszálon fut, a rajzolás után megszűnik, és a tool-outputja nem szennyezi vissza a fő kontextet. A prompt-cache szempontjából ez a döntő különbség egy friss subagenthez képest: a fork a **már meleg prefixet** örökli (cache-read), nem tölti be újra ugyanazt minden rajzoláshoz.

Ezzel párhuzamosan két adósság is rendezendő: a fő specek (`openspec/specs/graph-worker`, `openspec/specs/wall-feed`) máig a **pivot előtti** autonóm-producer modellt írják normatívként, tehát a repo saját source of truth-ja ellentmond a megépített rendszernek; és a `@anthropic-ai/sdk` függőség jelenleg csak holt kódot szolgál ki (a hiánya frissen klónozott gépen eltöri a buildet).

## What Changes

- **Új producer-modell:** a wall producer a fő Claude Code session **forkja**, szűk szekció-megbízással. Megrajzolja a rábízott slotot, emittál a meglévő `set-copilot wall-emit` seamen, majd kilép. Egy üzenetben több fork is indítható — szekciónkénti párhuzamosság.
- **A bázis-kontextus hordozza a rajzolási szerződést.** Amit minden rajzoláshoz tudni kell (kategória-registry, emit payload-alakok, render-típusok, rajzolási konvenciók), az a `set-copilot prompt` policy-jébe kerül, session indulásakor egyszer betöltve — így a fork ingyen örökli. A fork-prompt csak a megbízás.
- **BREAKING:** `@anthropic-ai/sdk` törlése a `dependencies` közül.
- **BREAKING:** `src/wall/producers/graph-worker.ts`, `src/wall/producers/run-feed.ts` és a `wall-feed` CLI-subcommand törlése. Jelenleg holt kód: a `runWall` sosem példányosítja, a CLI help nem is dokumentálja.
- **A `wall-producers` D9 felülírása** — a „fő session az extractor/emitter" helyett „a fő session *forkja* az extractor/emitter". A D9 empirikus tanulsága (grounding nélkül túl-gyűjt) megmarad és teljesül.
- A **D9 adatvédelmi kitétele tárgytalanná válik**: nem marad olyan út, amin a transcript külön modell-klienshez menne.
- A `chart` render-típus **spec-követelményt kap**. Ma a `display-categories` spec szerint a render „exactly `text` or `graph`", miközben a chart működő, renderelt artefaktum — a spec és a kód ellentmond.

## Capabilities

### New Capabilities
- `fork-producer`: a fork-alapú producer szerződése — mit örököl, mit kap megbízásként, mikor indul, mikor szűnik meg, hogyan párhuzamosítható szekciónként, és mi a fork-korlátok (szülő-modell öröklés, nem long-poll) normatív következménye.

### Modified Capabilities
- `wall-feed`: a „Hybrid control" követelmény ma azt írja elő, hogy az autonóm producer figyelje a transcriptet és a fő session maradjon KÍVÜL a per-tick kritikus úton. Ezt a fork-modell váltja fel. A „Latency budget" követelmény Haiku-ra szabott 1–4 s-os gráf-budgetje is újratárgyalandó, mert a fork a szülő modelljén fut.
- `graph-worker`: a „Direct-to-hub emission" követelmény („The main session SHALL NOT be on the critical path of a graph delta") a fork-modellben más értelmet nyer — a fő session *kontextusa* van az úton, a *turnje* nem. A capability a Haiku-worker törlésével nagyrészt visszavonandó.

**Nem itt:** a `chart` render-típus javítása (`text | graph` → `text | graph | chart`) a `display-categories` capabilityt érinti, ami **még nincs a fő specekben** — a `monitor-wall-display` change delta-specjében él. Két change nem definiálhatja ugyanazt a capabilityt, ezért ez itt *task* (a `monitor-wall-display` deltájának javítása), nem spec-delta.

## Impact

**Kód:** `src/wall/producers/` (törlés), `src/cli.ts` (`wall-feed` subcommand törlése), `src/copilot-prompt.ts` + `src/config.ts` (a rajzolási szerződés bekerül a bázis-policy-be), `src/wall/types.ts` (`RenderType` már tartalmazza a `chart`-ot — a spec igazodik hozzá).

**Függőségek:** `@anthropic-ai/sdk` eltávolítása. Marad: `ws` (Soniox). Ezzel a wall-út **modell-SDK-mentes** lesz — a modellhívás vagy a Claude Code sessionön belüli fork, vagy tartalékként `claude -p`.

**Specek:** `openspec/specs/graph-worker` és `openspec/specs/wall-feed` szinkronba hozása a ténylegesen megépített rendszerrel; `openspec/specs/display-categories` még nincs a fő specekben (a `monitor-wall-display` change-ben él) — a `chart` javítás ott esedékes.

**Mérés:** a `wall-feedback-and-replay` 5.1/5.2 taskjai előfeltétellé válnak — a fork-per-emisszió latency- és költségprofilja nem következtethető a Haiku-kutatásból.

**Nem érinti:** a display-modellt (kategória → slot × viselkedés), a zone-routingot, az SSE-t, a `wall-emit` seam drótformátumát. A producer cserélődik, a seam nem.
