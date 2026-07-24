## 1. A `silence`-hook mint felkészülési ablak

- [ ] 1.1 `skills/meeting-copilot/SKILL.md`: a `silence` esemény kiterjesztése — a szünet felkészülési
      ablak; rövid (egy-két lépéses) trajektória-extrapoláció a valószínű következő témára (D2)
- [ ] 1.2 A staging-fork mandátuma egy soros: „rajzold elő a valószínű következő vizuált **privátba**";
      a fork ne olvasson forrást, ha a privát mandátum elég pontos (a drága ág elkerülése)
- [ ] 1.3 A felkészülés nem versenyez a reaktív úttal: a staging csak `silence`-ablakban indul, nem
      minden mondat után

## 2. Privát staging-doboz és a prediktív mandátum

- [ ] 2.1 `src/config.ts`: privát staging-doboz a `DEFAULT_WINDOWS` privát nézetében (a prediktív vizuál
      `zone: "private"` ide kerül)
- [ ] 2.2 A prediktív mandátum a privát doboz policyjében (config, nem `src/`-logika): „hozd felszínre,
      amit nem tud, és amit mindjárt tudnia kell" (D5, `box-policy`)
- [ ] 2.3 `src/copilot-prompt.ts`: a prediktív mandátum renderelése a privát doboz szekciójában
- [ ] 2.4 Teszt: a prediktív mandátum a privát doboz szekciójában renderelődik; policy nélkül a kimenet
      változatlan

## 3. A staging: privát vizuál, autonóm publikálás nélkül

- [ ] 3.1 A prediktív esemény `zone: "private"`-ként megy be az ingesten; a publikus falra **nem** jut
      el automatikusan (D1)
- [ ] 3.2 Ha kell egy `staged` jelölés a vizuálon (`src/wall/types.ts`), az a staging/promote állapotot
      hordozza, geometria/tartalom nélkül
- [ ] 3.3 **Kulcsinvariáns-teszt** (szerveroldali, a `verify.mjs` mintája nyomán): egy prediktív esemény
      után egy publikus kliens **semmit** nem kap belőle promote nélkül

## 4. Promote-kapu

- [ ] 4.1 `src/wall/server.ts`: a promote mint egy meglévő privát vizuál **zóna-emelése** (nem
      újrarajzolás), a `show`/emit nagyságrendjében (D3)
- [ ] 4.2 A kapu ember- vagy szabály-vezérelt: default a felhasználó egyetlen megerősítése; opcionális
      szabály (a beszélgetés eléri a témát) `private`→`public` tiszta vizuálra
- [ ] 4.3 Ha a `wall-public-redaction` landolt és a cél-zóna `both`/publikus, a promotolt esemény
      ugyanazon a redakción megy át, mint bármely publikus esemény (D3)
- [ ] 4.4 Teszt: a promote a meglévő vizuált emeli (nincs újrarajzolás); a promotolt esemény eléri a
      publikus klienst; redakció jelenlétében a redakció érvényes rá

## 5. Elévülés

- [ ] 5.1 Egy fel nem használt predikció elévül (időablak vagy bizonyított divergencia); a privát
      nézetben jelölve elengedődik (D4)
- [ ] 5.2 Elévülés után a predikció **nem** promotolható
- [ ] 5.3 Teszt: divergáló beszélgetés + elévülési ablak → a staged vizuál elengedve, jelölve, és
      promote-ra már nem jogosult

## 6. Lezárás

- [ ] 6.1 `CLAUDE.md`: a wall szekció — a „prepared, not published" minta és a `silence`-felkészülés
- [ ] 6.2 `npm run build` és `npx vitest run` zöld
- [ ] 6.3 Az invariáns kézi/adverzariális ellenőrzése: nincs olyan út, amin egy még el nem hangzott
      predikció automatikusan publikus klienst ér
