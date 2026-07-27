# Handoff — transcript-stitch: a darabolt sorokból olvasható, AI-barát átirat

**Bejelentő:** `consumer-f` projekt (2026-07-27, élő meeting-copilot session)
**Státusz:** kérés, nincs elkezdve. `/opsx:propose` anyagnak szánva.
**Prioritás:** P0 — bizonyítottan *tudásvesztést* okoz, nem kényelmi kérdés.

---

## 1. Miért — a kiváltó eset

A `consumer-f` projektben egy ügyfél-tény **elveszett a feldolgozási láncban**, és csak
két héttel később, véletlenül került elő.

A 2026-07-14-i ügyfélhívásban a másik fél (`system` csatorna) elmondta, hogy hol tárolják a
céges anyagaikat. A capture ezt **hat sorra darabolva** írta ki, közé ékelve a `mic` csatorna
párhuzamos mondatait:

```
56520 system  cuccot, mert ugye nekünk Google Drive-on
58560 system  izé, több gigányi iz
60540 system  é, doksi van összehalmozva,
62520 system  hogy teljesen vegyesen, teh
64560 system  át így az árajánlattól a speci
66180 system  fikációig, izé, minden.
```

Összefűzve ez egyetlen mondat:

> „…mert ugye nekünk Google Drive-on több gigányi doksi van összehalmozva, teljesen vegyesen,
> tehát így az árajánlattól a specifikációig, minden."

A jegyzetelő lépés (LLM, nyers `.jsonl`-ből) ezt **nem ismerte fel** — se a szűrt
meeting-jegyzetbe, se a knowledge-wikibe nem került be. Két hét múlva ugyanennek a projektnek
a demója **pont ezen a kérdésen állt** („van-e valódi minta-dokumentum az ügyféltől, vagy mock
adaton fut a demó"), miközben a válasz végig ott volt a felvételben.

Figyeld meg a `speci` + `fikációig` határt: ez **szó közbeni vágás**, tehát az összefűzésnek
szeparátor nélkül kell ragasztania. A `hogy teljesen vegyesen, teh` + `át` ugyanez.

### A hiba nem a capture-ben van (már)

Az `a30d12f` fix (2026-07-26) a *keletkezést* javította: a másik csatorna megszólalása többé
nem üríti a beszélő pufferét, és az új sorok `startTs` / `partial` / `cont` / `midWord`
mezőket kapnak. **De:**

- **Előre hat, visszamenőleg nem.** A 2026-07-26 előtti felvételek darabolva maradtak, és ma
  is azokból épül a tudás.
- **A darabolás önmagában nem is szűnt meg.** Mérve két valós felvételen (kisbetűvel kezdődő,
  tehát mondat közben induló sorok aránya):

  | Felvétel | Sorok | Medián sorhossz | Töredék-sorok |
  |---|---|---|---|
  | 2026-07-14 (fix előtt, kétcsatornás) | 1451 | 22 karakter | **51%** |
  | 2026-07-27 (fix után, kétcsatornás) | 745 | 24 karakter | **38%** |

  A javulás valós (~13 pont), de a fogyasztó **továbbra is töredékeket kap**. Ez elvárt: a
  writer sorhatárai (mondatvég / 3 mp csend / 80 token) sosem fognak mondatokat garantálni két
  átfedő sávnál. **A hiányzó darab a fogyasztói oldalon van: nincs újraépítő lépés.**

- **A mezők ma senkinek nem szólnak.** A `cont`/`midWord`/`startTs` pontosan azért került be,
  hogy a sorhatárok visszafordíthatók legyenek — de a `poll` és a skillek nyers sorokat adnak
  tovább, és **egyetlen fogyasztó sem használja őket**. Ma egy `set-copilot`-felhasználónak
  saját szkriptet kell írnia, hogy a saját felvételét el tudja olvasni.

---

## 2. Mit kérünk

### A) `set-copilot transcript` — post-process parancs

Nyers `.jsonl` → olvasható, AI-barát `.md`. Minimum felület:

```bash
set-copilot transcript [--input <jsonl|mappa>] [--out <md>]
                       [--speakers mic=Gábor,system=Robi] [--redact <json>] [--stats]
```

- `--input` elhagyható: alapból a runtime dir utolsó archivált transzkriptje (a `handover.ts`
  `lastTranscript()` logikájának mintájára).
- `--out` elhagyható: alapból a bemenet mellé, `.jsonl` → `.md`.
- `--stats` a stderr-re: hány szegmens, hány mondat, hány szóhatár volt **egzakt**
  (`cont`/`midWord`-ből) és hány **tippelt** (heurisztika) — ez a régi felvételeknél a
  megbízhatóság mérőszáma.

### B) Automatikus előállítás a `stop`-nál

A `cmdStop` → `handoverAtStop` → `handoverTranscriptOnce` láncban, **az archiválás után**, a
végleges path-ból készüljön el a `.md` is, és a `stop` írja ki mindkettőt:

```
[set-copilot] Transcript saved: …/transcript-2026-07-27T12-22-47-907Z.jsonl
[set-copilot] Readable:        …/transcript-2026-07-27T12-22-47-907Z.md
```

Ez a lényeg: **senki ne felejtse el lefuttatni.** A mostani hiba pontosan attól állt elő,
hogy a feldolgozás a nyers fájlból indult, mert az volt kéznél.

Konfigból kapcsolható legyen (`transcript.stitchOnStop`, default **be**), és a
`--print` (diktálás, `/dd`) ágat **ne érintse** — ott a nyers szöveg a felhasználó üzenete,
nem dokumentum.

### C) Batch/backfill mód

Mappára vagy glob-ra ráengedhető futtatás, hogy a meglévő archívum egy menetben feldolgozható
legyen. Nagyságrend (5 projekt, 2026-07-27-i állapot):

| Projekt | Transzkript-fájl |
|---|---|
| `consumer-a` | 179 |
| `set-promo` | 38 |
| `consumer-c` | 29 |
| `set-designer` | 8 |
| `consumer-f` | 4 |
| **összesen** | **258** |

A stitch tömegesen futtatható; a drága rész utána az emberi/LLM kör, hogy *mi esett ki a
jegyzetből*. Ezt nem a set-copilot végzi — csak tegye lehetővé.

---

## 3. Az algoritmus már megvan — portolni kell, nem kitalálni

Működő, éles referencia-implementáció:

```
~/code/consumer-c/scripts/meeting-transcript-build.mjs   (276 sor, plain JS, nulla függőség)
```

Ez a `consumer-c` projektben készült ad hoc, és pontosan ezt a három dolgot oldja meg:

1. **Csatornánkénti újraépítés.** A szegmensek *egy csatornán belül* hiánytalanok, tehát a
   csatorna szövege összefűzhető, és utána a **kész mondatok** fűzhetők időrendbe. Kulcs:
   `rebuildChannel()` → `splitSentences()` → időrendi merge `start` szerint.
2. **Szóhatár-döntés.** `separator()`: ha van `cont`/`midWord`, **az dönt** (egzakt);
   ha nincs (régi felvétel), szótár-heurisztika — a teljes magyar funkciószavak listája
   (`COMPLETE_WORDS`) + 2,5 mp-nél nagyobb szünet → biztosan szóhatár. A tippelt határok
   száma a `--stats`-ban látszik.
3. **Capture-rotáció.** A 2 órás korlátnál a `ts` nulláról indul újra; `applyRotationOffset()`
   eltolja a második szakaszt a valós idővonalra, és a kimenetben jelöli a törést. (Ez a
   `docs/wall-field-backlog.md` **#5** tételével rokon — ha a rotáció maga megszűnik, ez az ág
   a régi felvételekhez akkor is kell.)

További, átvehető képességek ugyanonnan: `markOverlaps()` (átfedő megszólalás jelölése `⇄`),
`hhmmss` időbélyeges markdown-render `**[00:01:05] Gábor:**` formában, redakciós ablakok
(`--redact`) kivágása indoklással.

**Portolási feladat:** `src/transcript-build.ts` (TS, strict), a `cli.ts`-be egy `case
"transcript"`, és vitest-fedés a tiszta logikára — pontosan úgy, ahogy a
`transcript-writer.test.ts` teszi. A hangláncot nem érinti, tehát **teljesen unit-tesztelhető**.

---

## 4. Tervezési döntések, amiket kérünk

1. **A stitchelt `.md` legyen a knowledge-feldolgozás kanonikus forrása**, a `.jsonl` pedig
   archívum. Ez az egyetlen pont, ami a mostani hibát *strukturálisan* kizárja — ha a
   jegyzetelő lépésnek nincs miből nyers sorokat olvasni, nem is fog. Javasoljuk, hogy a
   `meeting-copilot` skill `stop` szakasza is a `.md`-re mutasson.
2. **Egycsatornás (`--mic-only`) felvételre is fusson.** A diktálásnál is darabolódnak a
   mondatok (80 token / 3 mp csend), csak nincs keresztcsatornás vágás.
3. **A `speakers` térkép jöjjön configból** (`transcript.speakers: {"mic": "Gábor"}`), CLI-ből
   felülírhatóan — a `mic`/`system` címke önmagában olvashatatlan egy jegyzetben.
4. **Ne veszítsen információt.** A `.md` mellett érdemes megfontolni egy stitchelt `.jsonl`-t
   is (mondatonként egy sor, `startTs`/`endTs`/`speaker`/`overlap`), hogy a gépi fogyasztók ne
   markdownt parse-oljanak. A `.md` az embernek és az LLM-nek, a `.jsonl` a szerszámoknak.
5. **Nyitott, nekünk mindegy:** a stitch legyen-e külön parancs *és* stop-lépés (javaslatunk:
   igen, mindkettő — a parancs a backfillhez kell), vagy csak a capture leállásakor fusson
   in-process.

---

## 5. Élhatárok, amikbe bele fogtok futni

- **Üres / félbeszakadt transzkript** — a `handoverTranscriptOnce` `null`-t ad üres fájlra; a
  stitch ugyanígy legyen no-op, ne írjon nulla bájtos `.md`-t.
- **`{"type":"silence"}` / `{"type":"reconnect"}` sorok** — a referencia-szkript kiszűri
  (`if (o.type || !o.text) continue`). A `reconnect` viszont **érdemi**: ott szavak hiányozhatnak.
  Érdemes a kimenetben jelölni (`> ⚠ [00:12:31] kapcsolat-szakadás, N ms — itt szavak hiányozhatnak`),
  különben az LLM egy hiányos mondatot ép mondatként olvas.
- **Régi felvételek `startTs` nélkül** — a `startTs` csak `a30d12f` óta létezik; fallback a
  `ts`-re kötelező, különben a rendezés a *befejezési* sorrendet adja vissza, ami két
  csatornánál nem a beszéd sorrendje.
- **Ne kerüljön ügyfél-transzkript a repóba.** A `docs/PRE-PUBLISH.md` szellemében a
  regressziós fixture legyen **szintetikus**, a fenti hibaalakot reprodukálva
  (`…a speci` + `fikációig…` szó közbeni határ, keresztcsatornás beékelődéssel). A valódi
  felvételek a `consumer-f` / `set-promo` repókban maradnak.

---

## 6. Elfogadási kritériumok

1. A szintetikus fixture-ön a hat töredékből **egy** mondat áll elő, a `speci|fikációig`
   határon **szeparátor nélkül**, a `Drive-on|több` határon szóközzel.
2. `--stats` kiírja az egzakt vs. tippelt szóhatárok számát; a `cont`/`midWord`-öt hordozó
   (fix utáni) bemeneten a **tippelt = 0**.
3. Kétcsatornás bemeneten a mondatok `startTs` szerint vannak időrendben, nem `ts` szerint.
4. Rotált (2 órás korlátot átlépő) bemeneten a második szakasz nem ugrik vissza a meeting
   elejére, és a törés jelölve van.
5. `set-copilot stop` a `.jsonl` mellé `.md`-t is előállít és mindkettő path-át kiírja;
   `/dd` (`--print`) viselkedése változatlan.
6. `npm test` zöld, `tsc --strict` tiszta.

---

## 7. Kapcsolódó, már ismert tételek

- `docs/wall-field-backlog.md` **#4** (Soniox félrehallja a szakszavakat és a neveket) — a
  glosszárium-normalizálás **a stitch után** a természetes helye: ott már teljes szavak és
  mondatok vannak, nem token-töredékek. Érdemes egy lépcsőnek tervezni a kettőt.
- `docs/wall-field-backlog.md` **#5** (2 órás korlát kettévágja a felvételt) — ha megszűnik, a
  rotáció-kezelő ág a meglévő archívumhoz akkor is kell.
- `a30d12f` — a capture-oldali fix, amire ez a munka épül (`startTs`/`partial`/`cont`/`midWord`).

## 8. Hivatkozások

| Mi | Hol |
|---|---|
| Referencia-implementáció | `~/code/consumer-c/scripts/meeting-transcript-build.mjs` |
| Kiváltó felvétel (nyers, ügyfél-adat) | `~/code2/set-promo/docs/sales/clients/black-belt/meeting-notes/2026-07-14-csakany-robi-copilot-raw-part1.jsonl` |
| Fix utáni mért felvétel | `~/code/consumer-c/.set/copilot/326821d8-…/transcript-2026-07-27T07-28-35-205Z.jsonl` |
| A hiba felfedezése (meeting) | `~/code/consumer-f/.set/copilot/6384c1bc-…/transcript-2026-07-27T12-22-47-907Z.jsonl` |
| Érintett forrásfájlok | `src/cli.ts` (`cmdStop`), `src/handover.ts`, `src/transcript-writer.ts`, `src/config.ts` |
