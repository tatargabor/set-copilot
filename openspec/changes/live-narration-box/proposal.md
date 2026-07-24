## Why

Három projekt élő átiratának visszaolvasásából a **leghangosabb, legtöbbször ismételt panasz**, hogy a
copilot túl néma, és a bal oldali szövegdoboz nem él: *„legyél bőbeszédűbb"*, *„folyamatosan frissítsd a
kommentjeidet a bal oldali szövegdobozban"*, *„csak egyetlen komment, amit írtál"*, *„a text bal oldalon
nem frissül"*, *„mikor kértem több infót, nagyon lassan írogatta ki"*. Egy mért session-ben 2 óra alatt
14 súgás-event ment ki. A copilot mai alapértéke a `reactive` engagement: **kategória-eseményre** szólal
meg, egyébként hallgat — így a fal legtöbbször halottnak látszik, és a felhasználónak *szóban* kell
pótolnia a hiányzó narrációt a közönség felé.

A jelenlegi taxonómia (⚠/📋/✏/❓) továbbra is helyes az **eseményekhez** — de a felhasználó nem
eseményeket, hanem **folyamatos, tartalmi kísérőszöveget** kér: „mi zajlik most, mihez kötődik". Ez egy
külön csatorna, nem a néma alapállás felhangosítása.

## What Changes

- **Új `live-narration` képesség: folyamatosan frissülő narráció-doboz.** A copilot a privát fal egy
  szövegdobozába ütemes, **tartalmi** kísérőszöveget ír arról, ami épp elhangzik — egy-egy tömör sor
  batch-enként / a `silence`-ablakban —, nem eseményre várva.
- **A narráció külön csatorna az alert-taxonómiától.** Az ⚠/📋/✏/❓ változatlanul esemény-vezérelt marad;
  a narráció egy önálló kategória (`narráció` 💬), amit a privát szövegdoboz feliratkozásként fog. Kategória
  hozzáadása **config**, nem `src/`-módosítás.
- **Verbosity-kar (config, nem kód).** A narráció bőbeszédűsége egy konfigurálható szint, ami a `copilot.*`
  policyben él és a `copilot-prompt.ts` rendereli — nem regex a `src/`-ben. Alapból bőbeszédűbb a mai néma
  állapotnál, de projektenként hangolható, **a mai `reactive` alert-viselkedés megtartása mellett**.
- **A NO-FILLER szabály feloldva, nem megsértve.** A narráció akkor is szól, amikor egy alert-kategória nem
  tüzel, de **tartalomról** beszél (miről van szó, mi dől el, mihez kötődik a tudásbázisból) — sosem
  „figyelek"/„várok" tölteléksor.
- **Privát alapértelmezés.** A narráció a **privát** nézetbe kerül; a publikus falra emelése a zóna-modellen
  és a külön `wall-public-redaction` changen múlik — élő közönség előtti szöveg redakció nélkül nem megy ki.

## Capabilities

### New Capabilities
- `live-narration`: A copilot ütemes, tartalmi kísérőszöveget ír egy dedikált privát narráció-dobozba,
  az alert-taxonómiától elkülönítve, konfigurálható bőbeszédűséggel és megtartott NO-FILLER garanciával.

### Modified Capabilities
<!-- Nincs: a wall-feed event-/payload-modellje változatlan (a narráció sima `text` payload egy új
     kategóriában); az engagement/verbosity a copilot-prompt policy renderelése, nem egy meglévő spec
     követelménye. -->

## Impact

- `src/config.ts` — új `narráció` alap-kategória; a `DEFAULT_WINDOWS` privát szövegdoboza feliratkozik rá;
  új verbosity/narráció-config kulcs a `copilot.*` alatt (merge + validáció, rossz érték → default).
- `src/copilot-prompt.ts` — a narráció-mandátum és a verbosity-szint renderelése (a `## Engagement` /
  per-box policy mellé); a `## Feedback` „wall echo" szabállyal összehangolva.
- `skills/meeting-copilot/SKILL.md` — a Phase 4/5 mechanika: batch-enként / `silence`-re egy tartalmi
  narráció-sor emitálása a privát dobozba (közvetlen `wall-emit`, fork nélkül — egy sor, nincs mit komponálni).
- Nincs audio-/capture-útvonal érintés. Tesztek: a narráció-mandátum és a verbosity a policy-kimenetben
  renderelődik; kikapcsolt narrációnál a kimenet változatlan (tiszta logika, `copilot-prompt.test.ts`).
