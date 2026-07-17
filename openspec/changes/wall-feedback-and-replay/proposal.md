## Why

Egy élő teszt megmutatta, hogy a fal *működik* a dróton (mic → transcript → poll → fő session →
`wall-emit` → SSE broadcast mind zöld), a **felhasználói élmény mégis töröttnek látszott**: a
copilot néma maradt, miközben hozzá beszéltek; egy chart-frissítés nem jelent meg a böngészőben;
és semmi nem jelezte, hogy a copilot él és mit értett meg.

A `monitor-wall-display` és a (már archivált) `wall-producers` change utólagos átnézése kimutatta:
**a hiba nem véletlen — a tervek saját, be nem teljesített részei.** Három elvégzendő volt nyitva
hagyva, egy egész koncepció pedig meg sem íródott:

1. **Chat↔fal viszony — sosem tervezték meg.** A `wall-producers` D1–D9 feltette, hogy „emittálj a
   falra", de sosem kérdezte: *mit lát/hall a felhasználó, hogy tudja, a copilot él és mit értett?*
   A fal lett az egyetlen kimenet, a chat elnémult — így egy működő rendszer halottnak látszott.
2. **State-replay granularitása — feloldatlan Open Question** (`monitor-wall-display` design). A
   „csak gráf + kitűzött latest, vagy a scroll-logok utolsó N sora is?" kérdés hallgatólagosan a
   „nincs scroll-history replay" defaultra esett — ezért nem látszott egy szöveges üzenet sem
   újracsatlakozáskor.
3. **Böngészős verifikáció (task 7.3/7.4) — sosem futott le.** A task szó szerint előírta a
   state-replay late-join böngészős ellenőrzését; headless SSE-próbákkal „igazoltuk", ami épp a
   lényeget nem fedte. A change úgy lett applyolva, hogy ez a pipa üres.
4. **Latency-mérés (task 5.3) — sosem történt meg.** A „szöveg ~10 ms / gráf 1–4 mp" a kutatásból
   van, nem élő futásból; a change lelke (latency a hot-pathon) mérés nélkül maradt.

Ez a change **ezt a négy tartozást zárja le** — nem új funkció, hanem a meglévő tervek beteljesítése.

## What Changes

- **Chat = elsődleges hang, fal = másodlagos artefaktum (új koncepció).** A copilot sosem megy
  teljesen némába, amikor hozzá beszélnek vagy épp dolgozik: a **chatben** ad rövid nyugtázást /
  értelmezést („hallak", „ezt értem belőle", „így olvastam a számokat — jó?"), a **falra** a
  letisztult vizuál kerül. A fal soha nem az egyetlen visszajelzési csatorna.
- **Bizonytalan értelmezés kérdés, nem tény.** Ha a kinyerés többértelmű (pl. „4-szer ennyi / fele
  ennyi"), a copilot a chatben **jelzi a feltevését** vagy rákérdez, nem tényként rakja a falra.
- **State-replay a scroll-history utolsó N sorával** — a késve csatlakozó ablak a kitűzött
  latest-ek + gráf-állapot **mellé** megkapja a scroll-kategóriák utolsó N sorát is.
- **Szerver újraépíti az állapotot a kanonikus JSONL-logból induláskor** (a `monitor-wall-display`
  D7 ígéretét valóra váltva) — nem csak memóriából. Így egy újraindítás nem veszti el a falat, ha a
  log megmarad; és tilos a logot menet közben üríteni élő használat alatt.
- **Böngészős verifikációs protokoll — kötelező kapu.** Egy ember-a-böngésző-előtt checklist a
  reconnect/replay/render élő ellenőrzésére; enélkül a wall-iteráció nem számít késznek.
- **Élő latency-mérés és -rögzítés** — valódi számok modalitásonként (szöveg render-hop, gráf/chart
  spec→render), stabil, nem-újraindított szerveren.

## Capabilities

### New Capabilities
- `wall-feedback`: a chat↔fal visszajelzési szerződés — a chat az elsődleges hang (liveness,
  nyugtázás, értelmezés), a fal a másodlagos vizuál; a bizonytalan értelmezés a chatben kérdés.
- `wall-replay`: a state-replay teljessége — scroll-history (utolsó N) a replayben, és az
  akkumulált állapot újraépítése a kanonikus JSONL-logból induláskor.

### Modified Capabilities
<!-- Nincs synced main spec a display-hez (a `monitor-wall-display` még nem archivált, a specjei
     nincsenek az openspec/specs/-ben), ezért ez a change ADDED requirementeket ad, nem MODIFIED-et.
     A becsatlakozás a meglévő event-source / replay varraton történik, a szerver magját a replay-
     bővítésen és a startup-rebuildingen túl nem írja át. -->

## Impact

- **Kód:** `src/wall/server.ts` — a `replay()` bővítése scroll-historyval; egy startup-rebuild, ami a
  `wall-events.jsonl`-t végigolvassa és újraépíti az akkumulált állapotot (a `jsonlTailSource` már
  visszajátssza a sorokat — a kérdés, hogy az `accumulate()` fusson-e rájuk induláskor). A scroll-
  history tárolása (`latest` mellé egy rövid ring-buffer a scroll-kategóriáknak).
- **Skill/config:** `meeting-copilot/SKILL.md` Phase 5 átírása a chat↔fal policyre; a `copilot.*`
  seam esetleges kiegészítése (a nyugtázás/értelmezés mértéke config, nem beégetett prózát a skillbe).
- **Verifikáció:** egy dokumentált böngészős checklist (docs) + a `monitor-wall-display` task 7.3/7.4
  lezárása egy valódi böngésző-menettel.
- **Mérés:** élő latency-számok rögzítése (docs/ROADMAP #6).
- **Nincs érintve:** az audio → Soniox → transcript → poll lánc; a kategória/slot/zóna modell; a
  runtime-dir invariánsok; a director pacing.
- **Tesztelhetőség:** a tiszta logika vitest-tel (scroll-ring-buffer, JSONL-rebuild determinizmusa);
  a reconnect/replay/render élő érzete a böngészős checklisttel (headless nem fedi — ez a 3. tartozás
  tanulsága).
