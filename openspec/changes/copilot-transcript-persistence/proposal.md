## Why

A meeting-módú copilot-átirat leállításkor **nem kerül átadásra egyszer, pontosan egyszer**, ahogy a
diktálásé. A `/meeting-copilot stop` a `set-copilot stop`-ot `--print` nélkül hívja, a `cmdStop` viszont
csak `--print` esetén archivál (`printTranscriptOnce`). Így a meeting `transcript.jsonl` névtelenül a
runtime-dirben marad, és csak a **következő** capture `archivePrevious`-e forgatja félre — nincs tartós,
dátumozott meeting-artifact, és nincs visszajelzés, hova mentődött. A felhasználó pontosan ezt élte meg:
*„mintha a Copilot nem mentené ugyanúgy a SET Copilot alá, mint a dictation, ami baj"*, illetve *„nem
minden megy be automatikusan, csak ha szólok neki."*

A diktálásnak van egy load-bearing invariánsa (CLAUDE.md): *egy átirat pontosan egyszer adódik át* — a
`stop --print` kinyomtatja, majd átnevezi `-<timestamp>.jsonl`-re, hogy egy dupla `/dd` ne játssza vissza
frissen elhangzottként. A meeting-mód ezt az invariánst **nem alkalmazza a leállításkor**, ezért nincs
megbízható, egyszer-átadott, felfedezhető meeting-átirat post-meeting feldolgozásra.

## What Changes

- **Meeting-stop átad egyszer, pontosan egyszer.** Leállításkor a meeting-átirat archiválódik egy
  dátumozott `transcript-<timestamp>.jsonl`-be, a diktálás handover-invariánsát tükrözve — de a **tartalom
  visszanyomtatása nélkül** (a meeting flow nem akarja a session-be visszajátszani a teljes átiratot; az
  újra „elhangzottként" hatna).
- **Az archiválás és a nyomtatás szétválik.** A `stop` mindig átad (archivál) leállításkor és kiírja a
  **mentett fájl útját**; a `--print` továbbra is *ráadásként* a tartalmat is kiadja (a diktálás `/dd`
  útja változatlan marad). A meeting-stop az útra kap visszajelzést, a tartalomra nem.
- **A `/meeting-copilot stop` jelenti a mentett átirat útját** a záró összegzésben, post-meeting
  feldolgozáshoz.
- **A runtime-dir invariánsok megmaradnak:** átad egyszer, pontosan egyszer; archivál, soha nem csonkol;
  élő dir-ben egy második capture továbbra is elutasított.

## Capabilities

### New Capabilities

- `meeting-transcript-persistence`: A meeting-módú átirat tartós, egyszeri átadása leállításkor — dátumozott
  archív-artifact és felfedezhető út, a diktálással szimmetrikusan, a tartalom visszajátszása nélkül.

### Modified Capabilities

<!-- Nincs: a `wall-feed` és a `graph-worker` fő specek nem érintettek; a stop-handovernek ma nincs saját
     fő spec-je, ezért új capability készül. -->

## Impact

- `src/cli.ts` — `cmdStop` / `printTranscriptOnce`: az archiválás (handover) leválasztása a nyomtatásról;
  a mentett út kiírása; a diktálás `--print` útja bitre változatlan.
- `skills/meeting-copilot/SKILL.md` — a stop-flow archiváló stopot használ, és a záró összegzésben jelenti
  a mentett átirat útját.
- `src/capture.ts` / `src/config.ts` — csak ha a handover-artifact elnevezéséhez vagy egy `capture.output`
  jelöléshez kell (valószínűleg nem; a meglévő `capture.output` + `archivePrevious` elég).
- Nincs breaking change: a diktálás `/ds`/`/dd` viselkedése változatlan.
