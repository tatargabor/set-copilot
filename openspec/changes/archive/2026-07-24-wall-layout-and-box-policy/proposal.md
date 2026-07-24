## Why

A fal működik, de egyszerre egy dolgot mutat, egy oszlopban: a `gridTemplate()` fixen
`gridTemplateColumns: "1fr"`-t ad vissza (`src/wall/public/wall-core.mjs`), a stíluslap pedig
kimondja, hogy „the wall never lays slots side by side" (`src/wall/public/wall.css`). Egy valódi
fal viszont a szöveget az ábra *mellé* kéri, nem fölé — és azt kéri, hogy a vizuális terület azt
mutassa, amit a pillanat kíván (most diagram, aztán chart, aztán egy képernyőkép) anélkül, hogy a
layout alatta változna.

Amint nekifutunk, két mélyebb probléma kerül elő. Az első: a megjelenítési modell három külön
fogalmat csúsztatott egybe. A `WallWindow.slots[].area` egyszerre pozíciónév és CSS grid-area, a
megjelenített tartalom *fajtáját* pedig implicit az dönti el, hogy a slot milyen render-típusú
kategóriára van feliratkozva. Nincs mód kimondani, hogy „ezen a helyen egy prezentációs doboz van",
függetlenül attól, mely kategóriák etetik.

A második: a tartalom-policy (`copilot.instructions`, `copilot.alerts`, `copilot.engagement`,
`copilot.drawing.conventions`) session-szintű — egy darab, az egész futásra. Egy doboznak viszont
lehet saját *viselkedése*, nem csak zóna-szűrése: a privát súgódoboz ellenőrzi, amit a beszélő mond,
és felszínre hozza, amit nem tud. Egy globális policy ezt nem tudja dobozonként kifejezni, így ma a
különbség informálisan, az operátor fejében él.

(A publikus narráló doboz — a privát ellenpárja — ugyanezt a mechanizmust használta volna, de a
publikus-zóna redakcióval együtt elhalasztásra került; lásd lentebb.)

## What Changes

- **Három-rétegű megjelenítési modell.** A `layout` és a `doboz` első osztályú fogalommá válik az
  ablak és a tartalom között: **ablak → layout → dobozhely → doboz**. A *layout* nevesített,
  configból deklarált sablon, ami dobozhelyeket és azok geometriai elrendezését (oszlopok, sorok,
  arányok) definiálja. Az *ablak* ezután már csak hozzárendelés: melyik dobozhelyre melyik doboz
  kerül. A CSS grid template a layoutból származik, nem a slot-listából.
- **Horizontális layoutok.** **BREAKING** a layout-motorra nézve: a `gridTemplate()` nem ad többé
  fix egy oszlopot. A mai függőleges elrendezés megmarad — de mint *nevesített layout*, nem mint
  bedrótozott szabály.
- **Négy slot helyett két doboz.** Az alapértelmezett ablakok egy **szövegdobozból** (bal harmad) és
  egy **prezentációs dobozból** (jobb kétharmad) állnak, a mai `pinned` / `hints` / `canvas` /
  `chart` négyes helyett.
- **A payload választ renderert.** A prezentációs doboz a beérkező esemény payloadja alapján vált
  renderert, nem a doboz kategória-feliratkozása rögzíti a render-típust. Ez az, ami lehetővé teszi,
  hogy egy doboz gráfot, chartot, képet és weboldalt is tudjon mutatni.
- **Új render-típusok.** `image` (lokális fájl vagy URL) és `webpage` bekerül a render-típus
  vocabularybe, ami ma zárt: `["text", "graph", "chart"]` (`src/wall/categories.ts`), és a
  `src/config.ts` explicit kimondja, hogy ez a teljes készlet. Ez tehát **tudatos engine-bővítés**,
  és így is rögzítjük — nem véletlen átcsúsztatás a config-seamen.
- **Doboz-scope-ú tartalom-policy.** A policy session-globálisról doboz-scope-ra kerül: minden doboz
  deklarálhat saját instrukciókat, alert-kategóriákat és engagement szintet. A `set-copilot prompt`
  dobozonként rendereli a szekciót egyetlen globális blokk helyett. A session-szintű alak érvényes
  marad, és minden doboz ezt örökli defaultként.
- **A publikus zóna keményítése (nem redakció).** A `/media` útvonal kiterjesztés-allowlistet és
  `realpath`-alapú confinementet kap (szimlink-szökés ellen), a szerver alapból `127.0.0.1`-re köt
  (a `listen(port)` egymaga `0.0.0.0`-t adott), az esemény-validáció a `wall-emit` CLI-ről átkerül a
  megosztott `ingest` funnelbe (a JSONL-tailer eddig megkerülte), és egy ablak csak azoknak a
  kategóriáknak az eseményeit kapja meg, amelyekre valamelyik doboza feliratkozott (egy `both`-zónás
  súgás így nem ül ott renderelhetetlenül a publikus fal drótján).

> **Kivéve maradt: az automatikus publikus-zóna redakció.** Az eredeti terv szerint a `both`-zónás
> események takarítva jutottak volna a publikus falra. Megépítettük, majd egy adverzariális
> átvizsgálás után **kivettük**: a mezőlistás takarító átengedte a szabad formájú payload-kulcsokat
> és az URL-eket, a replay pedig átemelte a privát gráf-előzményt. Ez saját, rendesen megtervezett
> changebe került (`wall-public-redaction`), a reprodukált támadásokkal mint kiindulóponttal. **Amíg
> az nem landol, az alapértelmezett fal privát:** a `/wall` csak gráfot és chartot mutat (mint eddig
> is), publikus szövegdoboz nincs.

**A függő feszültség feloldása.** A `src/config.ts` kimondja, hogy szándékosan nincs nyers
transzkript kategória, mert a fal csak *feldolgozott* kimenetet mutat. Ezt a change **nem** írja
felül: a publikus narráló doboz — ami közel került volna hozzá — a redakcióval együtt elhalasztva.

## Capabilities

### New Capabilities

- `box-policy`: Doboz-scope-ú tartalom-policy — mire való egy doboz, mit mondhat, és hogyan
  komponálja a `prompt` renderer a dobozonkénti szekciókat a configból, megőrizve a globális
  defaultot.

> A `public-redaction` capability ebből a changeből **kikerült** (lásd fentebb), és a
> `wall-public-redaction` changebe költözött.

### Modified Capabilities

- `display-layout`: A slot-alapú kompozíciós követelményt felváltja a három-rétegű modell
  (layout → dobozhely → doboz); a CSS Grid substrate követelmény elveszti az egy-oszlop
  megkötést; a viselkedések (`scroll`, `latest`, `pacing`) a slotról a dobozra kerülnek; a
  render-típusok payload-vezéreltté válnak.
- `display-categories`: A render-típus vocabulary megnyílik az `image` és `webpage` felé, és a
  renderer-választás a doboz kategória-feliratkozásáról az esemény payloadjára kerül.

> Megjegyzés: a `display-layout` és a `display-categories` ma az **archiválatlan**
> `monitor-wall-display` change delta-specjeiben él, még nincs bent az `openspec/specs/`-ben. Az
> itteni delták azok ellen íródtak, és feltételezik, hogy a `monitor-wall-display` előbb landol.

## Impact

**Kód**

- `src/wall/public/wall-core.mjs` — a `gridTemplate()` layout-sablont fogyaszt a slot-listából
  levezetett fix egy oszlop helyett.
- `src/wall/public/wall.css` — az egy-oszlop szabály és a hozzá tartozó komment.
- `src/wall/public/wall.js` — dobozhelyenként egy elemet mountol; a prezentációs doboz payload
  szerint dispatchel rendererre.
- `src/wall/types.ts` — a `WallWindow` / slot típusok layout + doboz bontása; a `WallConfig` layout
  registryt kap.
- `src/wall/categories.ts` — a `RENDER_TYPES` megnyílik.
- `src/wall/routing.ts`, `src/wall/director.ts` — a routing dobozhelyre kulcsol; a pacing doboz-
  tulajdonság.
- `src/wall/emit.ts` — validáció az új payload-alakokra (a `normalizeEvent` átkerül a szerver `ingest` funneljébe is).
- `src/wall/server.ts` — `/media` keményítés (allowlist + `realpath`), loopback binding, ablak-kategória szűrés a broadcaston.
- `src/config.ts` — `DEFAULT_WINDOWS` újrakomponálva, layout registry hozzáadva, a `copilot.*`
  policy doboz-scope-olhatóvá téve. A zárt-vocabulary komment **frissül**, nem néma ellentmondásba
  kerül.
- `src/copilot-prompt.ts` — dobozonkénti szekciók renderelése.
- `skills/meeting-copilot/SKILL.md` — csak mechanika; a dobozonkénti megbízás a `prompt`-ból jön.

**Tesztek**

`wall-core.test.ts` (grid-levezetés), `categories.test.ts` (render-típusok), `routing.test.ts`,
`emit.test.ts` (új payloadok, media confinement), `copilot-prompt.test.ts` (dobozonkénti renderelés). Mind
tiszta-logika teszt marad; a render-út a fal futtatásával ellenőrizhető.

**Dokumentáció**

`CLAUDE.md` — a wall szekció. (Külön, ehhez a changehez **nem** tartozó hiba: a `sonioxMode:
"chunk"` intervalluma 10s-ként van dokumentálva, valójában `chunkIntervalMs = 30_000`, és a modell
`stt-async-v4`. Ez előzetesen fennálló defekt, önálló javítást érdemel.)

**Kompatibilitás**

A meglévő, `windows[].slots`-ot deklaráló configok migrációt igényelnek a layout+doboz alakra. Mivel
a fal új és kiadatlan, a kemény átállás elfogadható — de az alapértelmezett konfigurációnak
reprodukálnia kell a mai függőleges elrendezést, hogy senkinek ne regresszáljon, aki már futtatja.

**Kockázat**

A legnagyobb tétű darab — az automatikus publikus-zóna redakció — **kikerült** ebből a changeből,
mert egy adverzariális átvizsgálás bebizonyította, hogy szivárog (mezőlistás takarító a szabad
formájú payloadon, URL-ek takarítatlanul, replay-zónamosás). Ehelyett a fal alapból **privát**: a
`/wall` csak gráfot és chartot mutat, és egy ablak csak a dobozai által feliratkozott kategóriákat
kapja meg. A redakció külön changeben (`wall-public-redaction`) épül újra, a reprodukált
támadásokkal mint kiindulóponttal. Amíg az nem landol, a fal nem használható éles közönség előtt
`both`-zónás érzékeny tartalommal.
