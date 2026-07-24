## Context

A fal ma egy oszlop. Nem konfigurációs korlát, hanem két helyen kimondott szabály: a
`gridTemplate()` fixen `gridTemplateColumns: "1fr"`-t ad vissza (`src/wall/public/wall-core.mjs`,
kommentben „Always ONE column"), és a `wall.css` is rögzíti („the wall never lays slots side by
side"). Ezt a `monitor-wall-display` change `display-layout` capabilityje írta elő — tehát nem
elhanyagolás, hanem szándékos egyszerűsítés, amit most vissza kell venni.

A `WallConfig` (`src/wall/types.ts`) egyébként már ma is örvendetesen deklaratív: kategória-registry,
ablakok, sőt egy `categoriesModule` seam is van a `knowledge.adapter` mintájára. A layout az egyetlen,
ami kilóg a config-vezérelt világból.

Egy élő mérés a mai teszt-ülésről, ami a policy-döntéseket alátámasztja: a fork-alapú producer
rajzolásonként **16–62 s** és **47–76k token**; a forrást is olvasó fork a lassú vég (42–62 s), a
csak komponáló ~17 s, a közvetlen `wall-emit` viszont **~1 s**. Ez nem a jelen change scope-ja, de
megmagyarázza, miért érdemes a doboz-policynek pontosnak lennie: egy pontos megbízás megspórolja a
forknak a forrásolvasást.

Egy meglévő invariáns, amit tiszteletben kell tartani: a `src/config.ts` kimondja, hogy szándékosan
nincs nyers transzkript kategória. A publikus narráló doboz ehhez veszélyesen közel áll, ezért a
viszonyát a specben explicitté tettük (`box-policy`), nem hagytuk implicit feloldani.

## Goals / Non-Goals

**Goals:**

- A megjelenítési modell három rétegre bontása (layout → dobozhely → doboz), configból vezérelve,
  futásidőben cserélhető layouttal.
- Horizontális (és általánosan tetszőleges rács-) elrendezés lehetővé tétele az egy oszlop helyett.
- Egy doboz, ami több render-típust tud fogadni, az esemény payloadja szerint váltva.
- `image` és `webpage` render-típus, tudatos engine-bővítésként rögzítve.
- A tartalom-policy doboz-scope-ra hozása, a session-globális alak megtartásával mint default.
- A publikus zóna alapszintű keményítése: `/media` confinement, loopback binding, ingest-validáció,
  ablak-kategória szűrés — hogy a fal **privátként** biztonságosan szállítható legyen.

**Non-Goals:**

- **Automatikus publikus-zóna redakció.** Az eredeti scope tartalmazta; egy adverzariális átvizsgálás
  után kikerült (lásd D6) és külön changebe (`wall-public-redaction`) költözött. Emiatt a fal
  alapból privát, publikus szövegdoboz nélkül.
- A producer-modell megváltoztatása. A fork marad, ahogy a `fork-producer` előírja; a mért
  latencia nem ennek a changenek a tárgya.
- Új capture- vagy transzkripciós út. A `speaker` (`mic` | `system`) primitív érintetlen.
- Tetszőleges beágyazott alkalmazások futtatása a falon. A `webpage` megjelenítés, nem futtatókörnyezet.
- A `CLAUDE.md`-ben talált `sonioxMode: "chunk"` dokumentációs hiba javítása — külön change.
- Többfelhasználós vagy távoli fal. A fal továbbra is lokális.

## Decisions

### D1 — A layout nevesített registry, nem ablakonként inline sablon

A layout külön, nevesített regiszterbe kerül (`wall.layouts`), az ablak pedig id-vel hivatkozik rá.

*Alternatíva:* minden ablak inline hordozza a saját rács-definícióját. Egyszerűbb egy fájllal, de
elveszik a lényeg: ugyanaz a `1/3–2/3` elrendezés kell a privát és a publikus ablakhoz is, és két
helyen karbantartott, kézzel szinkronizált rács garantáltan elcsúszik. A nevesített registry ezen
felül ingyen adja a futásidejű cserét: „váltsunk `focus` layoutra" egy id, nem egy geometria.

Ismeretlen layout-idre hivatkozó ablak **eldobandó figyelmeztetéssel**, nem üres oldallal — ez
illeszkedik a projekt meglévő mintájához (rossz kategória, rossz regex: dobd el, ne omolj össze).

### D2 — A doboz hordozza a viselkedést, a dobozhely csak a geometriát

A `behavior` (`scroll` | `latest`) és a `pacing` a **dobozra** kerül, nem a helyre. Egy doboz
áthelyezése másik pozícióba nem változtathatja meg, hogyan viselkedik.

*Alternatíva:* a pozíció hordozza (ma gyakorlatilag ez van, mert `area` és viselkedés ugyanabban a
slot-objektumban ül). Ez azért rossz, mert a „canvas" szó egyszerre jelent helyet és viselkedést, és
amint a helyet át akarod nevezni vagy mozgatni, a pacing véletlenül vele megy vagy véletlenül
lemarad. A szétválasztás pont az a hiba, amit ez a change orvosol — ne csináljuk félig.

### D3 — A renderert a payload választja, nem a kategória

Az esemény payloadja (`text` | `graph` | `chart` | `image` | `webpage`) dönti el a renderert; a
kategória `render` mezője csak *default*.

*Alternatíva:* dobozonként render-típus, és kategóriánként egy doboz. Ez az, ami ma van, és pont ez
kényszerít négy slotra: ha a chart és a gráf külön render-típus, akkor külön slot kell nekik, akkor
külön hely kell nekik, akkor a fal fele üresen áll, amikor épp csak az egyik van használatban.

*Ára:* egy esemény **pontosan egy** payloadot hordozhat. A `normalizeEvent` ma megengedőbb (elég,
ha *valamelyik* payload jelen van, `src/wall/emit.ts`). Ezt szigorítani kell: nulla vagy több payload
→ elutasítás figyelmeztetéssel. Ez apró viselkedésváltozás a beeresztő oldalon, és jobb most
szigorítani, amíg egy producer van.

### D4 — A media validáció a beeresztésnél történik, nem a rendernél

Az `image` és `webpage` forrása ingest-időben validálódik: abszolút URL, vagy a projekt-gyökéren
belülre feloldódó path. Kifelé mutató path elutasítva.

*Alternatíva:* a kliens próbálja betölteni, és ha nem megy, kezeli. Két baja van. Egyrészt egy
rossz forrás így már *broadcastolva* van, mire kiderül — a hiba egy élő kijelzőn jelenik meg.
Másrészt a path-traversal védelmet a szerver oldalon kell megcsinálni, nem a kliensben, mert a
fájlt a szerver szolgálja ki.

Egy render-idejű hiba (a kép nem tölthető be) **nem üríti ki a dobozt**: az előző tartalom marad.
Egy üres doboz vizuálisan megkülönböztethetetlen egy halott faltól — pont ezt a jelzést nem szabad
elveszíteni.

### D5 — A doboz-policy a globális felüldefiniálása kulcsonként, nem helyettesítése

A doboz effektív policyje = globális policy, kulcsonként felülírva a doboz sajátjával. Doboz-policy
nélkül minden pontosan úgy működik, mint ma.

*Alternatíva:* a doboz-policy teljesen kiváltja a globálisat. Ekkor minden dobozban meg kell
ismételni az engagement szintet, a maxLines-t és a teljes alert-taxonómiát — és a duplikátumok
elcsúsznak. A kulcsonkénti merge ugyanaz a minta, amit a `loadConfig` már használ a beágyazott
szekciókra, tehát nem új fogalom.

### D6 — Az automatikus redakció kikerült; a fal alapból privát

**Ez a change legnagyobb irányváltása, és utólag hozott döntés.** Az eredeti terv (D6–D8 korábbi
verziója) a `both`-zónás eseményeket a szerveroldali ingesten redaktálta volna: mezőnkénti takarítás,
kódszintű backstop, privát-nézet-jelölés. Megépítettük, majd **négy független adverzariális
verifikátor** futott rá azzal a mandátummal, hogy cáfolja. Reprodukálták, hogy:

- a mezőlistás takarító átengedi a szabad formájú payload-kulcsokat (`GraphNode` `[k]: unknown`,
  `chart.unit`, `node.id`) — a `DisplayEvent` payloadja nyitott, egy mezőlista sosem teljes;
- az `image.src` / `webpage.url` takarítatlan — az URL query-jében ott a titok;
- a replay a *legutolsó* delta zónájával írja felül a vizuál egészének zónáját, így privát
  gráf-előzményt emel át egy később csatlakozó publikus kliensnek.

A tanulság nem „javítsuk a mintát": a redakció mint *utólagos szűrő egy nyitott payloadon*
architekturálisan rossz. Rendes megoldás (rekurzív mély takarítás, URL-re visszatartás nem
tisztítás, delta-szintű zóna, ReDoS-korlát) külön, gondos tervezést érdemel — ezért **külön
changebe** (`wall-public-redaction`) került, a reprodukált támadásokkal mint kiindulóponttal.

Amit **helyette** e change megtart, mert a fal *privátként* is biztonságos kell legyen:

- **`/media` confinement** kiterjesztés-allowlisttel és `realpath`-tel — enélkül a `/media` egy
  autentikálatlan, szimlinket követő, tetszőleges-fájl olvasás volt a projekt-gyökér felett.
- **Loopback binding** alapból — a `listen(port)` egymaga `0.0.0.0`-ra kötött, a privát nézetet és a
  `/media`-t is a LAN-ra téve.
- **Ingest-validáció a megosztott funnelben**, nem csak a `wall-emit` CLI-n — a JSONL-tailer eddig
  vakon `as WireMessage`-re castolt, így minden séma-, payload- és media-ellenőrzés megkerülhető volt.
- **Ablak-kategória szűrés a broadcaston** — egy ablak csak a dobozai által feliratkozott kategóriák
  eseményeit kapja meg, így egy `both`-zónás súgás nem ül renderelhetetlenül a publikus fal drótján.

### D7 — A `webpage` beágyazás `sandbox="allow-scripts"`, `allow-same-origin` nélkül

*(A tervezés alatt nyitott kérdés, most eldöntve — a rögzítés a `wall.js`-ben és itt.)*

Az `iframe` `sandbox="allow-scripts"` + `referrerpolicy="no-referrer"` attribútumot kap,
**`allow-same-origin` nélkül**. Ez opak origin-be teszi a keretet: a beágyazott dokumentum futtathat
scriptet (különben a legtöbb oldal nem renderel), de nincs hozzáférése a fal DOM-jához, nincs
top-level navigáció, letöltés vagy popup. Az `allow-same-origin` kihagyása még azonos-origin URL-re
is megtagadja a szülő elérését. A `renderWebpage` a sémát is újraellenőrzi (`javascript:`, `data:`
tiltva), mert a kliens nem bízhat abban, hogy minden producer átment az ingest-validáción.

*Alternatíva:* szigorúbb izoláció (külön origin proxy, CSP-keret). Túllőtt egy lokális, egy
felhasználós falhoz; a sandbox-attribútum a böngésző natív határa, és a Non-Goal szerint ez
megjelenítés, nem futtatókörnyezet.

### D9 — A mai függőleges elrendezés nevesített layoutként marad meg

Nem töröljük, hanem `stacked` (vagy hasonló) néven bekerül a registrybe, és a default config
reprodukálja a mai megjelenést.

*Indok:* a change BREAKING a layout-motorra, és nem akarunk egy második törést a felhasználó
képernyőjén. Aki ma futtatja, annak a frissítés után ugyanaz jöjjön fel; a horizontális elrendezés
egy configsor, nem kényszer.

## Risks / Trade-offs

- **[A fal biztonsága a zónára és a producer fegyelmére támaszkodik]** → Redakció híján a `both`
  zóna = „mehet publikusra" a producer szava alapján. A kategória-szűrés megakadályozza, hogy egy
  privát súgás renderelhetetlenül a publikus drótra kerüljön, de nem tesz `both`-zónás tartalmat
  publikusan biztonságossá. A `public` fal ma **csak azt mutatja, amit egy producer szándékosan
  gráfnak/chartnak rajzol** oda; az automatikus szűrés a `wall-public-redaction`-re vár.
- **[A payload-vezérelt render nehezebben követhető]** → Egy doboz tartalma már nem olvasható le a
  konfigurációból, csak futásidőben derül ki. Cserébe ez a rugalmasság maga a cél. Enyhítés: a
  kategória `render` mezője megmarad mint dokumentált default, tehát a config továbbra is elárulja a
  *szándékot*.
- **[A `webpage` beágyazás tetszőleges távoli tartalmat hoz be]** → Megjelenítés, nem futtatókörnyezet
  (Non-Goal). A `sandbox="allow-scripts"` `allow-same-origin` nélkül a böngésző natív határa (D7).
- **[A doboz-scope-ú policy hosszabb promptot renderel]** → Dobozonként egy szekció több tokent
  jelent a session indulásakor. Cserébe a fork pontosabb megbízást örököl, és a mérés szerint épp a
  bizonytalan megbízás miatt olvas forrást (a drága ág). Nettóban valószínűleg nyereség, de érdemes
  mérni.
- **[Kompatibilitástörés a `slots` configokban]** → A fal kiadatlan, a törés elfogadható. A `stacked`
  layout mechanikailag reprodukálja a régi elrendezést (a legacy úton bizonyítva), így egy régi
  config változatlanul néz ki.
- **[A kliens pane-modell böngészőben nincs regresszió-tesztelve]** → A graph→chart→graph és a
  scroll-log megőrzés helyessége DOM-ot igényel; itt szerveroldalon és tiszta logikán ellenőrzött,
  a böngészős kézi ellenőrzés (8.6) nyitva marad.

## Migration Plan

1. Layout registry + típusok bevezetése úgy, hogy a régi `slots` alak még feloldódik a `stacked`
   layoutra — a lépés önmagában nem változtat semmit a képernyőn.
2. `gridTemplate()` átállítása layout-sablonra; a `wall-core.test.ts` mindkét alakra zöld.
3. Doboz-fogalom: `behavior` / `pacing` / policy a dobozra; routing dobozhelyre kulcsol.
4. Render-típusok megnyitása + payload-vezérelt dispatch + media validáció az ingest funnelben.
5. Publikus-zóna keményítés: `/media` confinement, loopback binding, ingest-validáció, kategória-szűrés.
6. Doboz-policy + `copilot-prompt` szekciónkénti renderelés.
7. Default config: `1/3–2/3` a privát nézetre, teljes-szélességű prezentáció a `/wall`-ra (szövegdoboz
   nélkül, amíg a redakció nem landol).

**Rollback:** a default windows visszaállítása a `stacked` layoutra visszahozza a mai megjelenést a
kód visszavonása nélkül.

## Open Questions

- **A `monitor-wall-display` archiválása.** A `display-layout` és `display-categories` delták
  archiválatlan changeben ülnek; tisztázandó, hogy az előbb landol-e, vagy a két change összevonandó.
- **Kell-e a layoutnak reszponzívnak lennie?** Egy `1/3–2/3` elrendezés egy álló monitoron rosszul
  fest. Egyelőre nem cél, de ha a fal többféle kijelzőn megy, a layout-választás kijelzőfüggő lehet.
- **Az „incremental graph append" követelmény** (`monitor-wall-display`) ma sérül: a `wall.js`
  `draw()` teljes újraépítést csinál. Örökölt, de érinti ez a change is; a `wall-public-redaction`
  vagy egy külön perf-change rendezze.
