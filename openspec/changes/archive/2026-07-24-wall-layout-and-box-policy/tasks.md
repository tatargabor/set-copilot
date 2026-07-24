## 1. Layout registry — a geometria kikerül a kódból

- [x] 1.1 `src/wall/types.ts`: `WallLayout` típus (`id`, `positions: string[]`, oszlop/sor arányok) és `WallConfig.layouts` registry
- [x] 1.2 `src/config.ts`: `DEFAULT_LAYOUTS` a mai függőleges elrendezéssel `stacked` néven (D9), plusz a `third-two-thirds` horizontális layout
- [x] 1.3 Layout-feloldás + validáció: ismeretlen layout-idre hivatkozó ablak eldobva figyelmeztetéssel, a többi ablak feloldódik (D1)
- [x] 1.4 Visszafelé kompatibilis feloldás: a régi `windows[].slots` alak a `stacked` layoutra képződik le, hogy ez a lépés önmagában ne változtasson semmit a képernyőn
- [x] 1.5 Teszt (`wall-core.test.ts` vagy új `layouts.test.ts`): registry feloldás, ismeretlen id eldobása, régi alak leképezése

## 2. `gridTemplate()` — a fix egy oszlop megszűnik

- [x] 2.1 `src/wall/public/wall-core.mjs`: a `gridTemplate()` layout-sablont fogyaszt; `gridTemplateColumns` / `gridTemplateRows` a layout arányaiból, nem fixen `"1fr"`
- [x] 2.2 Az „Always ONE column" komment eltávolítása/átírása — ne maradjon a kódban egy szabály, ami már nem igaz
- [x] 2.3 `src/wall/public/wall.css`: az egy-oszlop szabály és a „never lays slots side by side" komment feloldása
- [x] 2.4 `src/wall/public/wall.js`: dobozhelyenként egy elem mountolása a layout pozíciói alapján
- [x] 2.5 `wall-core.test.ts`: horizontális layout → `"1fr 2fr"` egy sorral; `stacked` layout → a korábbival egyenértékű egy-oszlopos template

## 3. A doboz mint önálló fogalom

- [x] 3.1 `src/wall/types.ts`: `WallBox` típus (`behavior`, `pacing`, `cats`, opcionális `policy`); az ablak `layout` + dobozhely→doboz hozzárendelés
- [x] 3.2 `behavior` és `pacing` átvitele a slotról a dobozra (D2) — a pozíció csak geometria marad
- [x] 3.3 `src/wall/routing.ts`: routing dobozhelyre kulcsol
- [x] 3.4 `src/wall/director.ts`: a pacing doboz-tulajdonságként olvasva
- [x] 3.5 `routing.test.ts` + `director.test.ts`: feliratkozás-szűrés dobozonként (`windowCats` kiemelve a `server.ts`-ből tiszta helperré); pacing követi a dobozt pozícióváltáskor

## 4. Render-típusok megnyitása és payload-vezérelt dispatch

- [x] 4.1 `src/wall/categories.ts`: `RENDER_TYPES` kiegészítése `image` és `webpage` értékkel
- [x] 4.2 `src/config.ts`: a „that is the whole render-type vocabulary" komment **frissítése** — a zárt vocabulary ténye marad, a készlet változik (a change nem hagyhat maga után néma ellentmondást)
- [x] 4.3 `src/wall/emit.ts`: **pontosan egy** payload megkövetelése; nulla vagy több → elutasítás figyelmeztetéssel (D3, viselkedésváltozás a mai megengedő ellenőrzéshez képest)
- [x] 4.4 `src/wall/public/wall.js`: renderer-dispatch a payload alapján, nem a kategória `render` mezője alapján
- [x] 4.5 `emit.test.ts`: egy payload átmegy; nulla és kettő elutasítva; a payload felülírja a kategória defaultját

## 5. Media payloadok (`image`, `webpage`)

- [x] 5.1 `image` payload validáció ingest-időben: abszolút URL **vagy** a projekt-gyökéren belülre feloldódó path (D4)
- [x] 5.2 Path-traversal elutasítás: a gyökéren kívülre mutató path nem megy át és a fájl nem szolgálódik ki
- [x] 5.3 `src/wall/server.ts`: in-project kép kiszolgálása a kliensnek (`/media`)
- [x] 5.4 `webpage` beágyazás: `iframe sandbox="allow-scripts"` `allow-same-origin` nélkül + `no-referrer`; a döntés a `design.md` D7-ben rögzítve
- [x] 5.5 Renderelési hiba (betölthetetlen forrás) esetén az előző tartalom marad, a doboz nem ürül ki — a media a betöltés **után** cserél be (D4)
- [x] 5.6 `emit.test.ts`: érvényes URL / in-project path átmegy; traversal és malformed forrás elutasítva

## 6. Publikus-zóna keményítés (a fal privátként biztonságos) — D6

> Az automatikus redakció **kikerült** (lásd a proposal/design D6-ot), és a `wall-public-redaction`
> changebe költözött. Ami itt marad: a fal privátként való biztonságossá tétele.

- [x] 6.1 `/media` confinement: kiterjesztés-allowlist + `realpath` (szimlink-szökés ellen) + null-byte + directory-check
- [x] 6.2 Loopback binding alapból (`host` opció, default `127.0.0.1`) — a `listen(port)` egymaga `0.0.0.0`-t adott
- [x] 6.3 `normalizeEvent` a megosztott `ingest` funnelbe (a JSONL-tailer eddig vakon castolt); `show`-parancs injektálás eldobva
- [x] 6.4 Ablak-kategória szűrés a broadcaston/replayen: egy ablak csak a dobozai kategóriáit kapja meg (a `both`-súgás nem ül a publikus fal drótján)
- [x] 6.5 A doboz `policy` mezője nem megy ki a böngészőnek (`publicWindowShape`)

## 7. Doboz-scope-ú policy

- [x] 7.1 `src/config.ts`: `BoxPolicy` típus; effektív policy = globális, kulcsonként felülírva a dobozéval (D5). *Megjegyzés: a merge a prompt-renderelésben történik (a policy prompt-anyag), nem futásidejű `effectivePolicy` függvény.*
- [x] 7.2 Default policy: privát súgódoboz (ellenőriz, felszínre hoz) — a publikus narráló doboz a redakcióval együtt elhalasztva
- [x] 7.3 `src/copilot-prompt.ts`: dobozonkénti szekció renderelése (név, zóna, render-felület, effektív megbízás)
- [x] 7.4 Doboz-policy nélküli config továbbra is **egyetlen** globális szekciót renderel, változatlan kimenettel
- [x] 7.5 `copilot-prompt.test.ts`: dobozonkénti renderelés; a policy nélküli eset nem rendel per-box szekciót

## 8. Default config átállítása és lezárás

- [x] 8.1 `DEFAULT_WINDOWS` újrakomponálása: privát nézet szövegdoboz (bal 1/3) + prezentáció (jobb 2/3)
- [x] 8.2 `/wall` teljes-szélességű prezentáció, **szövegdoboz nélkül** (a publikus narráció a redakcióra vár); a régi négyes helyett
- [x] 8.3 `skills/meeting-copilot/SKILL.md`: csak a mechanika frissítése + a fork-költség mérés
- [x] 8.4 `CLAUDE.md` wall szekció frissítése (a három-rétegű modell, render-típus készlet, a privát fal)
- [x] 8.5 `npm run build` és `npx vitest run` zöld (182 teszt)
- [ ] 8.6 **Kézi ellenőrzés valódi böngészőben** (itt nincs headless Chrome): `stacked` és `third-two-thirds` layout; graph→chart→graph váltás nem hagy üres dobozt; `scroll` log megmarad váltáskor; kép/weboldal renderel. *A szerveroldal és a tiszta logika node-ból ellenőrizve.*

## 9. Adverzariális átvizsgálás nyomán — mérleg

> Négy független verifikátor futott azzal a mandátummal, hogy **cáfolja**. Minden találat
> **reprodukált**. A layout/media/policy hibák javítva; a redakció szivárgásai a döntés nyomán a
> `wall-public-redaction` changebe kerültek (a fal addig privát).

**Javítva ebben a changeben:**

- [x] 9.1 `/media` tetszőleges-fájl olvasás → allowlist + `realpath` + loopback (6.1–6.2)
- [x] 9.2 `normalizeEvent` megkerülése a JSONL-taileren → validáció az `ingest` funnelben (6.3)
- [x] 9.3 `show`-parancs injektálás külső forrásból → eldobva az ingesten (6.3)
- [x] 9.4 Doboz-`policy` kiszivárgása a böngészőnek → `publicWindowShape` (6.5)
- [x] 9.5 `both`-súgás a publikus fal drótján → ablak-kategória szűrés (6.4)
- [x] 9.6 graph→chart→graph örökre üres doboz → pane-modell (rejtés, nem törlés), `wall.js`
- [x] 9.7 `show` kivétele megölte az SSE handlert → try/catch az `onShow`-ban
- [x] 9.8 `scroll` log elvesztése render-váltáskor → pane-modell
- [x] 9.9 Media-betöltési hiba okozta üres doboz → betöltés utáni csere (5.5)
- [x] 9.10 Chart/riasztás replay-regresszió az új default ablakokkal → minden feliratkozott kategória replayelhető (`indexBoxes`)
- [x] 9.11 Chart azonnal letörölte a paced gráfot (`minDwellMs` sérült, **saját regresszió**) → dwell-tisztelő pane-váltás

**Áthelyezve a `wall-public-redaction` changebe** (a szivárgó redakció-architektúra, reprodukcióval):

- [ ] → mély/rekurzív takarítás a szabad formájú payloadon (a mezőlista sosem teljes)
- [ ] → `image.src`/`webpage.url`: mintaegyezésre **visszatartás**, nem tisztítás
- [ ] → replay zóna-mosás: delta-szintű zónatárolás
- [ ] → `show` `visual` id zónázása
- [ ] → ReDoS-korlát a config-mintákon
- [ ] → megfigyelhetőség minden payload-típuson (nem csak szövegen)
- [ ] → személynév-default vs. explicit `names` lista: a spec szövege igazítandó

**Spec-adósság (külön rendezendő, nem ehhez a changehez):**

- [x] 9.12 A `display-layout` „runtime layout replacement" SHALL-ja a valósághoz igazítva: a
      layout-csere config-változás, ami a szerver (újra)indulásakor lép életbe — az élő, újraindítás
      nélküli csere nem követelmény (a decision: visszavéve, nem implementálva).
- [ ] 9.13 Az „incremental graph append" követelmény sérül (`wall.js` `draw()` teljes újraépítés) —
      örökölt a `monitor-wall-display`-ből; perf-changebe.
