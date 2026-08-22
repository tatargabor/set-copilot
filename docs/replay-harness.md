# A replay harness — visszamérhető copilot-minőség

Egy forgatókönyvet visszajátszunk a transcriptbe úgy, mintha a Sonioxtól jönne, és
megmérjük, mit csinál a copilot. Ettől lesz megválaszolható az a kérdés, amire eddig csak
emlékezni lehetett: **jobb vagy rosszabb lett?**

## Miért működik ez nulla motor-módosítással

A copilot soha nem beszél a Sonioxszal. Egyetlen bemenete a
`<runtimeDir>/transcript.jsonl`, amit a `poll`-on át olvas. A lejátszó ennek a fájlnak az
írója — nem új bemeneti mód. A `poll`, a fal, a mirror és a skillek **változatlanok**, és
nem is tudják, hogy nem mikrofon van a másik végén.

> Ha valaha kiderül, hogy a fogyasztói oldalt módosítani kell ahhoz, hogy a replay
> működjön, az **lelet egy rejtett csatolásról**, nem elkenendő. Két ilyen már volt, és
> mindkettő valódi hibának bizonyult (lásd lent).

## Amit a harness NEM tesztel

**A `transcript-writer`-t.** A forgatókönyv kész sorokat tartalmaz, nem token-folyamot,
tehát a flush-szabályok (mondathatár, 3 mp saját csend, 80 token túlcsordulás) nem futnak.
Ez szándékos: ha a fixture-t a flusheren engednénk át, a copilot nem a fixture-t látná,
hanem a flusher kimenetét, és a mérce megváltozna, valahányszor a flush logika változik.

Egy zöld scorecard tehát **soha nem jelenti, hogy a transcript-út rendben van.**

## Egy forgatókönyv három fájlja

```
scenarios/<név>/
  scenario.json      meta: név, forrásanyag, nyelv, reakció-kategóriák
  script.jsonl       a lejátszandó sorok + a szerzői metaadat, ami NEM játszódik le
  expectations.json  a beültetett pillanatok — a ground truth
  timeline.md        generált, olvasható idővonal
```

**A rekord becsomagolja a transcript-sort.** A `section` (melyik dia) csak az idővonalé.
Ha a lejátszott sorra kerülne, a copilot strukturált vázlatot kapna arról az előadásról,
amit fülre kellene követnie — és minden utána vett pontszám egy sosem szállított
copilotot mérne.

**Az időbélyegek a forgatókönyv kezdetéhez képestiek.** A lejátszó bázisolja újra, így a
fixture bármikor futtatható és futások között összehasonlítható.

## Forgatókönyv írása

1. **Olvasd el a forrásanyagot.** Számokat, állításokat, szerkezetet keress — a csapdák
   ezekhez lesznek kötve, és csak akkor ellenőrizhetők, ha a forrásban is benne vannak.
2. **Írd meg az előadást**, valós tempóval (~130 szó/perc magyarul ≈ 5–9 mp mondatonként),
   szekciókra bontva. A csendeket is tedd bele: a `silence` esemény a copilot egyik
   legfontosabb jelzése.
3. **Tegyél bele hallgatóságot** a `system` csatornán. Enélkül a futás sosem járja be a
   kétcsatornás utat — azt, amiért ez a package létezik.
4. **Szólítsd meg a copilotot** legalább egyszer (`command: true`).
5. **Ültess be csapdákat**, és mindegyikhez írd le, mit jelent a helyes reakció. Legalább
   egy ellentmondás, egy nyitott kérdés és egy döntés kell (`requiredKinds` felülírható).
6. **Generálj idővonalat és NÉZD ÁT.** Ez nem formalitás: egy át nem nézett forgatókönyv
   csendben hízelgő mércévé válik.

```bash
set-copilot scenario timeline scenarios/<név>   # generál
set-copilot scenario check    scenarios/<név>   # validál + elavultságot jelez
```

## Egy pontozott futás

```bash
# 1. fal (opcionális, de a rajz-dimenziókhoz kell)
SET_COPILOT_DIR=$D set-copilot wall --no-fake-feed &

# 2. lejátszás
SET_COPILOT_DIR=$D set-copilot replay scenarios/<név> &

# 3. a copilot — a policy betöltése az ELSŐ lépés
claude -p "... először: set-copilot prompt ... aztán poll-hurok ..." --allowedTools Bash

# 4. pontozás
SET_COPILOT_DIR=$D set-copilot replay-score scenarios/<név> --judge --out card.json
SET_COPILOT_DIR=$D set-copilot replay-score compare before.json card.json
```

**A runner-nek be KELL töltenie a `set-copilot prompt` kimenetét.** Egy kézzel írt
runner-prompt 2026-08-23-án úgy tűnt, két hiányt talált a rajzolási szerződésben; a
rendereltt prompt újraolvasása mindkettőt megcáfolta. Policy nélkül a futás olyan
copilotot pontoz, amit senki nem szállít, és a leletei zaj.

### Headless vs. interaktív

A headless runner (`claude -p --allowedTools Bash`) bírja a többkörös poll-hurkot. Egy
különbség dokumentálandó: **nincs `Monitor` tool**, tehát a hurok Bash-hurok. A run record
rögzíti, melyik módban készült.

## Sebesség — és melyik szám érvényes

| `--speed` | Mire jó | Latencia |
|---|---|---|
| `1` (alap) | baseline, latencia-állítás | **érvényes** |
| `>1` | tartalmi iteráció fejlesztés közben | érvénytelen |
| `0` | CI-szerű gyors átfutás | érvénytelen |

Gyorsítva a copilot **jobbnak látszik**, mert a modell gondolkodási ideje nem skálázódik a
lejátszással. Ezért a sebesség a run recordban van, és a scorecard a latencia-dimenziókat
érvénytelenként jelenti, nem kisebb számként. Ugyanez áll, ha **a lejátszó maga késett**
2 másodpercnél többet — az a szám a lejátszót írná le, nem a copilotot.

## A scorecard olvasása

| Dimenzió | Forrás | Jelentés |
|---|---|---|
| `coverage` | bírált | hány beültetett pillanat kapott reakciót |
| `reactionLatency` | számolt | átlagos késés a pillanattól a fal-eseményig |
| `precision` | bírált | a *reakció*-kategóriák hány százaléka kötődött beültetett pillanathoz |
| `draws` | számolt | rajzolt payloadok száma (aktivitás, nem minőség) |
| `predictionsPromoted` | számolt | előre rajzolt tippekből hány lett publikálva |
| `fillerShare` | számolt | a szöveges kimenet töltelék-aránya |

Egy dimenzió lehet **nem mérhető**, és ez nem hiba, hanem a lényeg:

- *nincs bírált egyeztetés* → a coverage **ismeretlen, nem nulla**;
- *nem valós idejű futás* → nincs latencia;
- *bélyegzetlen fal-esemény* → a coverage és a precision nem mérhető, mert egy bélyeg
  nélküli esemény sosem eshet egy pillanat ablakába. Ez a különbség aközött, hogy „a
  copilot nem reagált" és „a log nem tudja megmondani, mikor".

Az összehasonlítás **megtagadja a verdiktet**, ha a forgatókönyv ujjlenyomata változott: egy
elmozdult mércéhez képest mérni úgy néz ki, mint egy eredmény, és az rosszabb, mint a
semmi.

### A precision és a narráció

A copilot folyamatos dolgokat is csinál (narráció, kitűzött összefoglaló), amik jogosan
nem kötődnek beültetett pillanathoz. Ha mindet beszámítjuk, a copilotot azért büntetjük,
mert követi a saját policy-ját — mérve: 0,375 precision úgy, hogy minden pillanat meg volt
válaszolva. Ezért a forgatókönyv `reactionCategories` mezője mondja meg, mi számít
reakciónak. A kategória-nevek ott vannak és nem a motorban: a taxonómia a projekté.

## Amit a harness eddig talált

| Lelet | Státusz |
|---|---|
| A `poll` eldobta a capture végén olvasatlanul maradt sorokat — élő meetingen a záró perceket | javítva (`poll-drains-before-capture-dead`) |
| A fal-események nem hordoztak időbélyeget — egy terepi jelentés sosem volt ellenőrizhető | javítva (`wall-events-carry-a-timestamp`) |
| „Hiányos rajzolási szerződés" | **cáfolva** — a teszt-prompt nem töltötte be a policy-t |
