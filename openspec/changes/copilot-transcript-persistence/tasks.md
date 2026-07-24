## 1. Az archiválás leválasztása a nyomtatásról (`src/cli.ts`)

- [x] 1.1 `handoverTranscriptOnce(cfg)` kiemelése: a jelenlegi `printTranscriptOnce` archiváló fele
      (`renameSync` `-<timestamp>.jsonl`-re) tartalom-nyomtatás nélkül; visszaadja/kiírja a mentett utat, üres
      vagy hiányzó átiratnál no-op (D1, D3)
- [x] 1.2 `printTranscriptOnce` átalakítása: előbb kiadja a tartalmat (a diktálás útja), majd a közös
      `handoverTranscriptOnce`-ot hívja — egyetlen `renameSync` marad a forrás-igazság az „egyszer" invariánsra
- [x] 1.3 `cmdStop`: leállításkor **mindig** `handoverTranscriptOnce` (nem csak `--print` esetén); a `--print`
      továbbra is a tartalmat is kiadja a handover előtt (D1)
- [x] 1.4 A `stop` írja ki a mentett archív útját (`[set-copilot] Transcript saved: <path>`), hogy a
      meeting-flow és a felhasználó lássa, hova került (D2)

## 2. Runtime-dir szigor és idempotencia

- [x] 2.1 A handover kizárólag a stoppoló dir `lastTranscript(cfg)`-jét (a `capture.output` jelölőt) archiválja,
      soha nem csonkol, más session átiratához nem nyúl (D4)
- [x] 2.2 Egy időzítőre leállt capture után futó `stop` (nincs PID, de van fogyasztatlan átirat) is átad
      egyszer — a meglévő „print nélkül is fusson a handover" ág kiterjesztése (D3)
- [x] 2.3 A `--print` (diktálás) viselkedése bitre változatlan: tartalom + egyszeri archiválás

## 3. A meeting-copilot stop-flow (`skills/meeting-copilot/SKILL.md`)

- [x] 3.1 A `### /meeting-copilot stop` szekció rögzítse, hogy a `set-copilot stop` most archivál és kiírja a
      mentett átirat útját (nem kell `--print`, ami visszajátszaná a tartalmat)
- [x] 3.2 A záró összegzés tartalmazza a **mentett átirat útját** post-meeting feldolgozáshoz (D2)

## 4. (Opcionális) programozott elérés

- [ ] 4.1 (Kihagyva — a `stop` stdout `[set-copilot] Transcript saved: <path>` sora elég; a skill azt
      parse-olja. A `path last-archive` bejegyzés additív, ha később mégis kell, D5.) `path last-archive`
      bejegyzés a `cmdPath` map-be, ami a legutóbbi archivált átirat útját adja

## 5. Teszt és ellenőrzés

- [x] 5.1 Egységteszt (tiszta fájlrendszer, mikrofon nélkül): meeting-stop után az élő átirat eltűnik a
      konfigurált névről, megjelenik `transcript-<ts>.jsonl`-ként, a tartalom NEM kerül stdoutra, az út igen
- [x] 5.2 Egységteszt: második `stop` nem archivál/emittál újra (idempotencia); üres átiratnál no-op
- [x] 5.3 Egységteszt: `--print` (diktálás) továbbra is kiadja a tartalmat ÉS egyszer archivál
- [x] 5.4 `npm run build` + `npm test` zöld; kézi ellenőrzés: `/meeting-copilot stop` a záró összegzésben
      mutatja a mentett átirat útját
