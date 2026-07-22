## Context

A wall három change-en át épült: `monitor-wall-display` (a kijelző), `wall-producers` (a betápláló, archiválva), `wall-feedback-and-replay` (adósságtörlesztés, részben alkalmazva). A producer-kérdés ezalatt **kétszer fordult meg**:

1. `wall-producers` D1: „Producer = vékony process a modalitáshoz, **NEM** Claude Code subagent" — mert a subagent tool-loop overheadje a latency ellen dolgozna.
2. `wall-producers` D9 (implementáció közben): a Haiku-worker prototípus *mechanikusan* működött, de „grounding és szándék nélkül **túl-gyűjtött**" — 47-node-os hairball. Ezért a fő Opus session lett az extractor/emitter.

D9 ára, amit a `wall-feedback-and-replay` élő tesztje ki is mutatott: a producer a chat hot-pathján ül. Amíg a fő session mást csinál, a fal nem frissül.

Jelen állapot, amiből ez a change indul:
- `src/wall/producers/graph-worker.ts` + `run-feed.ts` **holt kód** — csak a `wall-feed` CLI-ból érhető el, ami a help-ben sincs dokumentálva, és a `runWall` sosem példányosítja. A kategóriák (`architektúra`, `metrika`) benne **hardkódoltak**, tehát a registry átnevezésekor némán elromlana.
- Az egyetlen valós függősége, `@anthropic-ai/sdk`, telepítetlen gépen **eltöri a `npm run build`-et** — a repo tsc-strict buildje nem megy át friss klónon.
- `openspec/specs/graph-worker` és `openspec/specs/wall-feed` a **pivot előtti** modellt írja normatívként (`"The main session SHALL NOT be on the critical path"`, `"driven by an autonomous producer"`) — a repo source of truth-ja ellentmond a megépített rendszernek.

## Goals / Non-Goals

**Goals:**
- A producer kerüljön le a chat hot-pathjáról **anélkül**, hogy visszahozná a D9 grounding-problémáját.
- A `wall-emit` drótformátum és a display-modell (kategória → slot × viselkedés, zone-routing, SSE) **változatlan** maradjon — a producer cserélődik, a seam nem.
- A wall-út legyen **modell-SDK-mentes**; a build friss klónon menjen át.
- A repo specjei írják le azt a rendszert, ami tényleg épül.

**Non-Goals:**
- Új display-primitívum, kategória-típus vagy render-mód (az a display-modell, kész).
- A `wall-feedback-and-replay` nyitott adósságai (scroll-replay, log-rotáció, böngészős gate) — azok ott maradnak, ez a change csak *előfeltétellé* teszi az 5.1/5.2 mérést.
- Kutató agent, ami külső infót szerez egy diagramhoz. Ez felmerült, de **külön change** — a fork-modell megnyitja az útját, de nem specifikálja.
- Long-poll várakozó worker-flotta (lásd D3).

## Decisions

### D1 — A producer a fő session forkja, nem külön modell-kliens

`subagent_type: "fork"` örökli a szülő teljes beszélgetési kontextusát, háttérben fut, és a lefutása után megszűnik.

**Miért ez oldja fel a D1↔D9 feszültséget:** a D9 kifogása nem a *párhuzamosság* ellen szólt, hanem a **kontextus-hiány** ellen — az autonóm Haiku nem tudta eldönteni, mi számít. A fork definíció szerint ugyanazt a megértést viszi, ami a chatben van. A D9 empirikus tanulsága tehát nem sérül, hanem *teljesül*: nem külön modell találgat, hanem ugyanaz a megértés folytatódik egy másik szálon.

**Alternatívák:**
- *Autonóm worker külön kontextussal* (D1/D3 eredeti) — elbukott a gyakorlatban (hairball).
- *Fő session emittál inline* (D9) — működik, de a hot-pathon ül.
- *Friss general-purpose subagent* — a groundingot minden rajzoláshoz újra be kellene töltenie: friss tokenek, cache-miss, lassú. Lásd D2.

### D2 — A rajzoláshoz kellő tudás a bázis-kontextusba tartozik, nem a fork-promptba

Amire **minden** rajzolásnak szüksége van — kategória-registry, `wall-emit` payload-alakok, render-típusok, rajzolási konvenciók (mikor gráf, mikor chart, mikor szöveg) — az a `set-copilot prompt` által renderelt policy-be kerül, és a session **indulásakor egyszer** töltődik be.

**Miért ez a döntő tétel:** a fork a szülő prompt-prefixét örökli, ami már **meleg a cache-ben** — tehát cache-read, nem friss input. Ha ugyanezt a tudást fork-promptban adnánk át, minden rajzolásnál újra beírnánk. A szabály:

> Ami minden rajzoláshoz kell → bázis-kontextus (egyszer, cache-elve).
> Ami csak ehhez a rajzoláshoz kell → fork-prompt (rövid megbízás).

Így a fork-prompt tipikusan egy-két mondat: *„rajzold meg a `metrika` slotot arra, amit az imént megbeszéltünk"*.

**Következmény a kódra:** ez a `copilot.alerts` / `copilot.instructions` mintáját követi — a szerződés **config, nem a skillbe írt próza**, hogy egy projekt a kategóriáit lecserélhesse a skill forkolása nélkül.

### D3 — Emisszió-per-igény, nem long-poll

Az eredeti vízió várakozó long-poll workereket képzelt el. A fork nem tud olcsón üresjáratban várni — egy várakozó fork a szülő kontextusát tartaná életben, hogy semmit ne csináljon.

Helyette: a fork **akkor indul, amikor van mit rajzolni**, és rögtön ki is lép. Ez amúgy is jobban illeszkedik a D9 tanulságához („csak amikor indokolt, nem tickenként").

### D4 — Szekciónkénti szűk megbízás, párhuzamosan

Egy üzenetben több fork indítható, egyenként **egy slotra** szólóan. A szűk scope maga is grounding: a forknak nem az egész transcriptből kell kitalálnia, mi fontos — konkrét megbízása van.

Ez a `wall-producers` D7 („MVP egy gráf-worker, a flotta később") skálázott verziója, csak most a flotta olcsóbb, mert nem N külön kontextus, hanem N örökölt.

### D5 — A fork a szülő modelljén fut; ezt elfogadjuk, nem kerüljük meg

A fork `model` override-ot **figyelmen kívül hagy**. Egy Opus-session forkja Opus.

Ezt tudatosan vállaljuk: (a) a gyakorlati tapasztalat szerint értelmes agenthez **minimum Sonnet** kell, a Haiku nem játszik — a D9 „túl-gyűjtés" diagnózisa részben modell-tier probléma volt; (b) a fork rövid életű és a rajzolás után kilép, tehát **keveset fogyaszt**; (c) a bemenete túlnyomórészt cache-read.

**Amit viszont mérni kell:** a `wall-feed` spec 1–4 s-os gráf-budgetje Haiku-ra volt szabva. Fork+Opus mellett ez **nem következtethető**, csak mérhető — ezért lesz a `wall-feedback-and-replay` 5.1/5.2 előfeltétel.

### D6 — Nincs modell-SDK a wall úton

A fork Bash-ből hívja a meglévő `set-copilot wall-emit` seamet. Nem kell `@anthropic-ai/sdk`, nem kell API-kulcs-kezelés, és **megszűnik a D9 adatvédelmi kitétele** is („csak az opcionális Haiku-offload küld transcriptet az API-nak") — nem marad ilyen út.

Ha valaha Claude Code sessionön *kívül* kell producer futtatni, a tartalék `claude -p`, nem SDK.

**Következmény:** `graph-worker.ts`, `run-feed.ts`, a `wall-feed` subcommand és az `@anthropic-ai/sdk` dependency **törlendő**. A `wall-feed` prototípus elvégezte a dolgát (bebizonyította, hogy a mechanika megy, és hogy grounding nélkül hairball lesz) — a tanulság a designban marad, a kód nem.

### D7 — A `chart` render-típus specet kap

A `display-categories` spec szerint a render „exactly `text` or `graph`", és a registry-validáció mindent mást eldob — miközben a `chart` működő, renderelt artefaktum (kézzel írt SVG, `types.ts` `RenderType`). A spec követi a kódot, nem fordítva: `text | graph | chart`.

## Risks / Trade-offs

**[A fork a szülő kontextusát örökli — ami a beszélgetéssel együtt nő]** → Hosszú sessionben minden fork egyre nagyobb prefixet visz. Cache-read mellett is nő a költség. Mitigáció: a forkot **korán és gyakran** indítsuk, ne kötegelve a session végén; és mérjük az 5.2-ben, hogy a felhasznált tokenmennyiség hogyan skálázódik a session hosszával.

**[A prompt-cache TTL lejárhat]** → Ha két rajzolás között hosszú a szünet, a prefix kihűl, és a következő fork teljes árat fizet. Mitigáció: ez elfogadható; **nem** szabad emiatt „cache-melegen tartó" álindításokat csinálni — az tiszta pazarlás.

**[A D5 modell-korlát költséget zár be]** → Nem tudunk olcsóbb tierre menni akkor sem, ha kiderül, hogy elég lenne. Mitigáció: ha ez fájni kezd, a `claude -p` tartalék út (D6) explicit modellválasztást enged — de akkor elveszik a kontextus-öröklés, tehát vissza a grounding-problémához. A csere nem ingyenes; adat kell hozzá.

**[Törlünk egy működő prototípust]** → A `graph-worker` mechanikusan működött. Mitigáció: a kód a git-történetben marad (`8fa425f`), a *tanulság* pedig a `wall-producers` D9-ben és ebben a designban van rögzítve. Holt kódot nem tartunk életben emlékeztetőnek.

**[A specek átírása visszamenőleg „csalásnak" tűnhet]** → A `graph-worker` / `wall-feed` fő specek olyan rendszert írnak le, amit a projekt eldöntött, hogy nem épít meg. Mitigáció: a `REMOVED Requirements` blokkok **Reason**-nel és **Migration**-nel dokumentálják, mi miért esik ki — a döntés nyoma megmarad, nem tűnik el a történet.

**[A latency romolhat a D9-hez képest]** → Egy fork spawn + inference lassabb lehet, mint amikor a fő session inline emittál. Mitigáció: cserébe a fő session nem áll meg rajzolni, tehát a *felhasználó által érzékelt* válaszidő javul. Ezt is az 5.1 dönti el, nem a vita.

## Open Questions

- Ki dönti el, hogy fork induljon? A fő session judgement-alapon (mint a mai `wall-emit`), vagy legyen egy explicit trigger a policy-ben (pl. kategória-tüzelés)? Hajlok az elsőre, de a második mérhetőbb.
- Hány fork párhuzamosan, mielőtt ez zajossá válik? A slotok száma felső korlát, de nem biztos, hogy mind egyszerre indokolt.
- ~~A fork emitáljon-e a chatbe is? Ki echóz — a fork vagy a szülő?~~ **Eldöntve (implementáció közben): a szülő echóz.** A fork kimenete definíció szerint nem jut vissza a szülő kontextusába, tehát ha a szülő nem mondja ki a spawn pillanatában, semmi nem jelzi a chatben, hogy történik valami — épp az a hiba állna elő, ami a `wall-feedback-and-replay`-t kiváltotta. A szülő tehát a fork indításakor azonnal ír egy sort arról, mit értett meg és mit rajzoltat; nem várja meg a fork végét.
- Egy soros szöveges jegyzethez indítsunk-e forkot? **Nem** — nincs mit komponálni, a fork csak latencyt adna; a szülő közvetlenül `wall-emit`-el. A fork a *vizuálok* eszköze.
