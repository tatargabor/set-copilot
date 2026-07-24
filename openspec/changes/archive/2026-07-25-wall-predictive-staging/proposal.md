## Why

A fal legfájóbb korlátja a latencia: egy élő mérés szerint a fork-alapú producer **16–62 s** és
**47–76k token** egy rajzért (a forrást olvasó fork a lassú vég), a közvetlen `wall-emit` viszont
~1 s. Mire egy diagram elkészül, a beszélgetés továbbment — a rajz a múltat mutatja.

Ugyanakkor a copilot ma tisztán **reaktív**: eseményre (mondat, `silence`, kulcsszó) reagál, a
trajektóriát nem használja. Pedig a beszélgetés iránya gyakran látszik egy-két lépéssel előre: egy
téma épp architektúra felé fordul, egy kérdés készül, egy döntés érlelődik. Ha a rendszer ezt az
előrelátást a `silence`-ablakban **felkészülésre** fordítaná, a lassú producer időben elkészülne —
és a latencia eltűnne a felhasználó szemszögéből.

A tét egy alapelv, amit nem szabad megsérteni. A `SKILL.md` és a `CLAUDE.md` ismételten kimondja: *„A
wall carries authority; don't lend it to a guess"*, *„Ambiguity is a chat question, not a wall fact"*,
*„Never invent numbers."* Egy predikció **találgatás**. Ha automatikusan a publikus falra kerül, egy
téves jóslat tekintélyt kap, mielőtt elhangzott volna — rosszabb, mint a hallgatás, és kísérteties a
résztvevőknek. A megoldás nem az alapelv feladása, hanem a már meglévő **zóna-modell** kihasználása: a
predikció a **privát** nézetben készül elő, és csak emberi vagy szabály-vezérelt kapun át kerül a
falra. **Prepared, not published.**

## What Changes

- **Trajektória-tudatos felkészülés a `silence`-ablakban.** A copilot a szünetet nem csak mélyebb
  lookupra használja, hanem egy rövid (egy-két lépéses) extrapolációra: merre tart a beszélgetés, mi
  lesz mindjárt releváns. Ez a felkészülést vezérli, nem a publikálást.
- **Privát staging.** A prediktív tartalom — egy előrerajzolt vázlat, egy előhozott korábbi döntés, egy
  releváns kontextus — `zone: "private"` eseményként készül el, a privát nézet egy staging-dobozában.
  A publikus falra **nem** megy magától. A drága rajz így a szünetben, előre elkészül.
- **Promote-kapu.** Amikor a beszélgetés tényleg odaér, a kész privát vizuál egy olcsó promote-lépéssel
  (~1 s, a rajz már megvan) a publikus zónába emelhető — a `silence`-hook szabálya vagy a felhasználó
  egyetlen megerősítése alapján. A promote sosem automatikus a publikus zónába egy még el nem hangzott
  predikció esetén.
- **Elévülés.** Egy fel nem használt predikció elévül (a beszélgetés máshova fordult): a staging-doboz
  csendben elengedi, jelöléssel a privát nézetben, hogy egy téves jóslat ne üljön ott vizuális zajként.

## Capabilities

### New Capabilities

- `predictive-staging`: Trajektória-tudatos, privát felkészülés (súgás és előrerajzolt vizuál) a
  `silence`-ablakban, és egy promote-kapu, amin át a kész privát tartalom emberi/szabály-vezérelt
  döntéssel a publikus falra kerül. A publikus zónába autonóm predikció nem megy.

### Modified Capabilities

- `box-policy`: A privát súgódoboz mandátuma kiterjed a felkészülésre: „hozd felszínre, amit nem tud"
  mellé „és amit mindjárt tudnia kell" — a predikció a privát doboz policyjében él, config, nem kód.

> Épít a `wall-layout-and-box-policy` zóna- és box-modelljére és a `silence` eseményre. A publikus
> narráció/redakció **nem** feltétele: a staging privát, a promote egy meglévő privát vizuált emel át,
> nem generál publikus szöveget. A `wall-public-redaction`-nel akkor találkozik, ha egy promotolt vizuál
> `both`-zónás — ilyenkor a redakció (ha már landolt) ugyanúgy érvényes rá, mint bármely más eseményre.

## Impact

**Kód**

- `skills/meeting-copilot/SKILL.md` — a `silence`-hook kiterjesztése: a szünet felkészülési ablak; a
  staging-fork mandátuma; a promote mechanikája. Mechanika ide, *judgement* a policyba.
- `src/config.ts` — a privát staging-doboz a `DEFAULT_WINDOWS`-ban (privát nézet); a prediktív mandátum
  a doboz policyjében; a promote-kapu szabály-paramétere (pl. elévülési idő).
- `src/copilot-prompt.ts` — a prediktív mandátum renderelése a privát doboz szekciójában.
- `src/wall/server.ts` — a promote mint egy privát vizuál zóna-emelése (a delta-szintű zóna, ha a
  `wall-public-redaction` már landolt, itt találkozik vele); az elévülés kezelése.
- `src/wall/types.ts` — a staging/promote állapot a vizuálon (ha szükséges egy `staged` jelölés).

**Tesztek**

- A `silence`-vezérelt felkészülés kiváltása (tiszta logika, ahol lehet); a promote zóna-emelés
  helyessége; az elévülés; és a kulcsinvariáns: **egy még el nem hangzott predikció sosem ér publikus
  klienst automatikusan** (szerveroldali teszt a `verify.mjs` mintája nyomán).

**Dokumentáció**

- `CLAUDE.md` — a wall szekció: a „prepared, not published" minta és a `silence`-felkészülés.

**Kockázat**

- **Spekulatív munka = kidobott token.** A már drága producer többet dolgozik, és a predikciók egy
  része sosem kerül elő. Enyhítés: csak `silence`-ablakban, csak privátba, és a promote olcsó (a rajz
  kész). A staging-fork ne olvasson forrást, ha a privát mandátum elég pontos.
- **Téves predikció.** A trajektória zajos. De privátban egy rossz jóslat csak egy elvethető súgás —
  nem publikus baklövés; pont ezért marad privát. Az elévülés a vizuális zajt is takarítja.
- **A publikus autonóm predikció csábítása.** Explicit Non-Goal (lásd `design.md`): sérti a fal
  alapelvét, nem egy paramétert. A promote mindig emberi/szabály-kapu.
