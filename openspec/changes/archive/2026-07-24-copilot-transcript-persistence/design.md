## Context

A gyökérok a `cmdStop`-ban van (`src/cli.ts`): a `stop` csak `--print` esetén hívja a
`printTranscriptOnce`-t, ami *kinyomtat, majd archivál* (átnevez `-<timestamp>.jsonl`-re). A
`meeting-copilot/SKILL.md` stop-flow-ja viszont `set-copilot stop`-ot hív **`--print` nélkül** — tehát
meeting-módban a leállítás megöli a capture-t, de az átiratot **nem** adja át és **nem** archiválja. A
`transcript.jsonl` így élőben ott marad a runtime-dirben, és csak a *következő* capture `archivePrevious`-e
(`src/capture.ts:116`) forgatja félre. Ebből fakad a felhasználó panasza: nincs egyszer-átadott, dátumozott
meeting-artifact, és nincs visszajelzés a mentés helyéről.

A diktálás ugyanezt az utat `--print`-tel járja (`/dd`), ahol a `printTranscriptOnce` a *tartalmat* is
kiadja — és ez helyes a diktálásnál (a szöveg a felhasználó üzenete). Meeting-módban viszont a tartalom
visszanyomtatása **káros**: a teljes átiratot újra „elhangzottként" adná a session-nek. A megoldás tehát nem
a `--print` bekapcsolása meeting-módban, hanem az **archiválás (handover) leválasztása a nyomtatásról**.

A folyamatos írás már ma megvan: a `TranscriptWriter` mondatonként appendel a lemezre, tehát „menet közben"
tartós — a hiányzó darab kizárólag a **leállításkori egyszeri átadás** és a **felfedezhető artifact**.

## Goals / Non-Goals

**Goals**
- Meeting-stop adjon át pontosan egyszer: dátumozott archív + a mentett út kiírása, tartalom nélkül.
- A diktálás `/dd` (`stop --print`) útja bitre változatlan.
- A `/meeting-copilot stop` jelentse a mentett átirat útját a záró összegzésben.

**Non-Goals**
- Nem vezetünk be új tárolóhelyet vagy adatbázist; a runtime-dir + `archivePrevious` mintát használjuk.
- Nem változtatunk a capture közbeni írási ritmusán (az már tartós).
- Nem építünk post-meeting elemzőt; csak elérhetővé tesszük az artifactot.

## Decisions

- **D1 — Archiválás ≠ nyomtatás.** A `printTranscriptOnce` kettéválik: egy `handoverTranscriptOnce(cfg)`
  ami *archivál és visszaadja/kiírja az utat* (tartalom nélkül), és a nyomtatás, ami a tartalmat is kiadja.
  A `stop` **mindig** hívja a handovert leállításkor; a `--print` *ráadásként* a tartalmat is kiadja a
  handover előtt. Így egyetlen `renameSync` marad a forrás-igazság az „egyszer, pontosan egyszer"-re.
- **D2 — A meeting-flow a tartalom nélküli utat kapja.** A `SKILL.md` stop `set-copilot stop`-ot hív (nem
  `--print`) — ez most már archivál és kiírja az utat. A skill a záró összegzésbe emeli az utat.
- **D3 — Idempotens és „árva átirat" barát.** A handover a meglévő `lastTranscript(cfg)` (a `capture.output`
  jelölő) alapján dolgozik, üres/hiányzó fájlnál no-op. Egy időzítőre leállt capture után futó `stop` is
  átad egyszer (ma is ezt teszi `--print`-tel; most `--print` nélkül is).
- **D4 — Soha nem csonkol, dir-birtokos.** Kizárólag `renameSync` (archivál), és csak a stoppoló runtime-dir
  `capture.output`-jára — a wall-lifecycle `wall-stop`-jához hasonló szigorral, hogy más session átiratához
  ne nyúljon.
- **D5 — Visszafelé kompatibilis felület.** A `--print` viselkedése (diktálás) nem változik. Egy opcionális
  explicit `--no-archive` szükségtelen; ha később kell, additív. A `path` map bővíthető egy `last-archive`
  bejegyzéssel, ha a skillnek programozottan kell az út — de elsőre a `stop` stdout-ja elég.

## Risks / Trade-offs

- **Kockázat:** ha valaki eddig a `transcript.jsonl`-re támaszkodott, hogy az a leállítás UTÁN is ott van
  változatlan néven, most az archivált néven találja. → Enyhítés: a `stop` kiírja az új utat; `status` és a
  `path transcript` továbbra is a konfigurált nevet adják a *következő* futáshoz.
- **Trade-off:** a handover a stopba kerül, nem a következő start `archivePrevious`-ébe. Ez szándékos: az
  átadás a meeting *végéhez* kötődik, nem a következő indításhoz, és így akkor is megtörténik, ha soha nincs
  következő capture ebben a dirben.

## Migration / Rollout

- Nincs adatmigráció. A `cmdStop` refaktor + egy `SKILL.md` szöveg. A meglévő tesztek (config/prompt) nem
  érintettek; új teszt a handover „egyszer, tartalom nélkül, út kiírva" viselkedésére (tiszta fájlrendszer-
  logika, mikrofon nélkül tesztelhető).
