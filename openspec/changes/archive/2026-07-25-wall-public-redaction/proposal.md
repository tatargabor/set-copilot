## Why

A `wall-layout-and-box-policy` change eredetileg tartalmazta az automatikus publikus-zóna
redakciót: a `both`-zónás események takarítva jutottak volna a publikus falra, hogy egy publikus
narráló szövegdoboz élő közönség előtt is biztonságos legyen. Megépítettük, majd **négy független
adverzariális verifikátor** futott rá azzal a mandátummal, hogy cáfolja — és cáfolta. A mezőlistás
takarító architekturálisan rossznak bizonyult egy nyitott payloadon, ezért a redakció **kikerült**
abból a changeből, és a fal alapból **privát** maradt: a `/wall` csak gráfot és chartot mutat,
publikus szövegdoboz nélkül.

Ez a change az elhalasztott képességet építi újra — de **nem a régi architektúrával**. A reprodukált
támadások (lentebb, a spec deltában szcenáriókként) a kiindulópont, nem egy utólagos jegyzet: minden
egyes megvalósításnak reprodukálhatatlanná kell tennie egy konkrét, bizonyított szivárgást.

A tét a legmagasabb a projektben: egy hiba nem egy hibás promptot eredményez, hanem **belső adatot
egy nyilvános falon, élő közönség előtt**. Ezért a tervezés alapelve a *fail-closed*: kétség esetén
az esemény visszatartva, nem tisztítva.

## What Changes

- **Rekurzív, mély takarítás — nem mezőlista.** A `DisplayEvent` payloadja nyitott (`GraphNode` és
  `ChartDatum` explicit `[k: string]: unknown`). A takarító **minden** string-levélen végigmegy a
  payload-fában, tetszőleges mélységben és kulccsal, nem egy előre felsorolt mezőhalmazon. Amit a
  mezőlista sosem fed le (`nodes[].secretNote`, `chart.unit`, `node.id`), az így nem szivárog.
- **URL-re visszatartás, nem tisztítás.** Az `image.src` és a `webpage.url` egy strukturált érték: a
  benne álló query-token nem takarítható úgy, hogy az URL használható maradjon. Ha egy redakciós
  minta illeszkedik a forrásra, a **teljes esemény visszatartva** a publikus zónából — nem egy
  megcsonkított URL megy ki.
- **Delta-szintű zóna a replayben.** A szerver akkumulált gráfja ma egy zónát tárol vizuálonként, és
  a *legutolsó* delta zónájával írja felül az egészet. Ez privát gráf-előzményt emel át egy később
  csatlakozó publikus kliensnek. A zóna a **delta** szintjére kerül, és a replay minden deltát a saját
  zónája szerint szűr.
- **A `show` parancs zónázása.** A `visual` id szabad producer-szöveg, ma szűretlenül megy minden
  klienshez (egy `[internal] project-hush` id megjelent a publikus kliensnél). A show a vizuál
  zónájára szűrve megy ki.
- **ReDoS-korlát.** A config-minták a szerver egy szálán, komplexitás-korlát nélkül futnak;
  `(a+)+$` 30 karakteren mérve 9 s — egy esemény megállítja az összes falat. A minták futása
  korlátozott (időkorlát és/vagy a katasztrofális visszalépés statikus elutasítása).
- **Megfigyelhetőség minden payload-típuson.** Egy redaktált gráf-címke, chart-cím vagy kép-felirat is
  jelet kap a privát nézetben — nem csak a szöveges payload.
- **Fail-closed hibakezelés.** Ha a takarítás bármely okból hibázik (minta-fordítás, időtúllépés), az
  esemény **nem** megy ki a publikus zónába. Ez szándékosan eltér a projekt szokásos „dobd el és menj
  tovább" mintájától: itt a „menj tovább" a szivárgás.
- **A taxonómia config, nem kód.** A package több projektben fut. A redakció *mechanizmusa* (rekurzív
  takarítás, URL-visszatartás, fail-closed) motor; a *taxonómiája* (minták, `[belső]` jelölés,
  név/term-listák) a `wall.redaction` config-seam mögött él, sosem `src/`-beli regexként — ugyanaz az
  elv, mint a `copilot.alerts` / `detect.*` / `knowledge.keywords` esetén. A default domain-semleges
  (jelölés-vezérelt), nem egy adott projekt szókincse — különben minden más projektbe visszaszivárogna.
- **A publikus narráló doboz visszahozása.** A redakció landolásával a default `/wall` újra kaphat egy
  szövegdobozt, ami a beszélő szavát narrálja — most már szűrve. A narráció *feldolgozott* kimenet
  (szűrt, tömörített), nem nyers transzkript, így a `src/config.ts` „nincs nyers transzkript"
  invariánsával összefér.

## Capabilities

### New Capabilities

- `public-redaction`: A `both`-zónás események mély, rekurzív takarítása a publikus zónába menet
  előtt; URL-re visszatartás; delta-szintű replay-zóna; fail-closed hibakezelés; ReDoS-korlát.

### Modified Capabilities

- `box-policy`: A publikus narráló doboz követelménye visszakerül (a `wall-layout-and-box-policy`
  innen távolította el), most már a `public-redaction` képességre támaszkodva.

> Megjegyzés: ez a change a `wall-layout-and-box-policy` **után** landol. Az onnan megtartott
> keményítés (`/media` confinement, loopback binding, ingest-validáció, kategória-szűrés) a biztonsági
> alapréteg, amire ez épül — nem ismételjük meg, feltételezzük.

## Impact

**Kód**

- `src/wall/redaction.ts` (új) — a mély, rekurzív takarító és az URL-visszatartás tiszta logikája.
- `src/wall/server.ts` — a takarító beépítése az `ingest` funnelbe a broadcast előtt; delta-szintű
  zóna az akkumulált gráfban; a `show` zónázása; fail-closed út.
- `src/wall/types.ts` — delta-szintű zóna a gráf-akkumulációban; a redaktált-jelölés a payload-típusokon.
- `src/config.ts` — `wall.redaction` szabályok (Unicode szóhatár `\p{L}\p{N}`, sosem `\b`; érvénytelen
  minta eldobva feltűnő figyelmeztetéssel); a publikus narráló doboz visszahozása a `DEFAULT_WINDOWS`-ba.
- `src/copilot-prompt.ts` — a narráló doboz megbízásának renderelése; a `[belső]` jelölési konvenció
  tanítása a producernek (ma fantom-konvenció: a default minta rá épül, de senki nem mondja el).

**Tesztek**

- `redaction.test.ts` — mély szivárgás minden reprodukált szcenárióra (payload-kulcs, URL, replay-mosás);
  `both`-zóna kétféle kimenete; fail-closed; érvénytelen minta → figyelmeztetés, nem crash; ReDoS-korlát.
- **Szerveroldali** redakciós teszt — a broadcast/replay/`show` út, nem csak a tiszta függvény.

**Dokumentáció**

- `CLAUDE.md` — a wall szekció: a redakció és a fail-closed alapelv.

**Kockázat**

A legmagasabb a projektben (belső adat nyilvános falon). Enyhítés: minden szcenárió a reprodukált
támadásból ered; fail-closed default; kódszintű backstop a prompt mögött; kötelező szerveroldali és
adverzariális verifikáció a landolás előtt. **Amíg ez nem landol és nincs adverzariálisan igazolva, a
fal privát marad** — a publikus narráló doboz nem kapcsolható be.
