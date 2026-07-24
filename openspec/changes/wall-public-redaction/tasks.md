## 1. Mély, rekurzív takarító (tiszta logika)

- [ ] 1.1 `src/wall/redaction.ts`: a payload-fát bejáró takarító, ami **minden string-levélre**
      alkalmazza a mintákat, tetszőleges mélységben és kulccsal (D1); nem-string levelet nem érint
- [ ] 1.2 Unicode szóhatár a mintákban (`\p{L}\p{N}`, sosem `\b`); érvénytelen minta eldobva
      **feltűnő** figyelmeztetéssel, capture nem áll meg (fail-closed a mintára, D5)
- [ ] 1.3 URL-forrás kezelése: ha minta illeszkedik az `image.src` / `webpage.url` bármely részére, a
      **teljes esemény visszatartva** a publikus zónából, nem tisztítva (D2)
- [ ] 1.4 `redaction.test.ts`: minden reprodukált szivárgás lezárva — `nodes[].secretNote`,
      `chart.unit`, `chart.data[].note`, `node.id`, mély beágyazás, URL-query token → visszatartás
- [ ] 1.5 A taxonómia a `wall.redaction` config-seam mögött, sosem `src/`-beli regex; a shippelt default
      domain-semleges (jelölés-vezérelt), nem egy adott projekt szókincse — a redakciós szabályok
      projektenként config-cserével bővíthetők, motor-szerkesztés nélkül (proposal + spec)

## 2. Delta-szintű zóna a replayben

- [ ] 2.1 `src/wall/types.ts` + `src/wall/server.ts`: az akkumulált gráf minden **deltához** eltárolja
      a saját zónáját (a „vizuál egy zónát hordoz" modell megszűnik, D3)
- [ ] 2.2 A replay egy csatlakozó kliensnek deltánként szűr a delta zónája szerint
- [ ] 2.3 Teszt: két `private` + egy `both` delta után egy publikus kliens csak a `both`/`public`
      deltákat kapja meg, a `private`-ket soha

## 3. A `show` zónázása

- [ ] 3.1 A `show` parancs a hivatkozott vizuál zónáját örökli, és csak a kompatibilis zónájú
      klienseknek megy ki (D4)
- [ ] 3.2 Teszt: egy `private` `visual:"[internal] project-hush"` show nem ér el publikus klienst, és az
      id-string nem jelenik meg a publikus falon

## 4. Beépítés az ingest funnelbe, fail-closed

- [ ] 4.1 A takarító beépítése az `ingest`-be a broadcast **és** az akkumuláció előtt, minden producer
      közös útján (a JSONL-tailert is beleértve — a szerver-hardening megkerülési osztálya)
- [ ] 4.2 `zone: "both"` kettéválasztása: privátba érintetlenül, publikusba takarítva vagy visszatartva
- [ ] 4.3 Fail-closed: ha a takarítás hibázik (fordítás, időtúllépés, váratlan alak), az esemény **nem**
      megy a publikus zónába; a privát megkaphatja (D5)
- [ ] 4.4 **Szerveroldali** teszt (a `verify.mjs` mintája nyomán, valódi HTTP+SSE): a broadcast/replay/
      `show` út, a `both`-szétválasztás, a publikus visszatartás — nem csak a tiszta függvény

## 5. ReDoS-korlát

- [ ] 5.1 A D6 eldöntött mechanizmusa (statikus elutasítás config-időben és/vagy futásidejű időbüdzsé
      és/vagy lineáris motor); a döntés a `design.md` D6-ba visszaírandó
- [ ] 5.2 Teszt: `(a+)+$` jellegű minta nem állítja meg a falat (a korlát érvényesül)

## 6. Megfigyelhetőség

- [ ] 6.1 A redaktált/visszatartott jelölés a `DisplayEvent` szintjén, minden payload-típuson látszik a
      privát nézetben (redaktált gráf-címke, chart-cím, kép-felirat is, nem csak szöveg) (D7)
- [ ] 6.2 Teszt/kézi ellenőrzés: egy redaktált gráf-címke jelet kap a privát nézetben

## 7. A `[belső]` konvenció tanítása

- [ ] 7.1 `src/copilot-prompt.ts` + drawing-kontraktus: a `[belső]` jelölés megtanítása a producernek
      (ma fantom-konvenció, a default minta rá épül, de senki nem mondja el) (D8)
- [ ] 7.2 A default minta és a tanított konvenció összhangja tesztelve

## 8. A publikus narráló doboz visszahozása

- [ ] 8.1 `src/config.ts`: a publikus narráló doboz visszahozása a `DEFAULT_WINDOWS`-ba (a `/wall`
      teljes-szélességű prezentáció + narráló szövegdoboz), a `public-redaction` meglétére támaszkodva
- [ ] 8.2 A narráló doboz megbízása: **feldolgozott** (szűrt, tömörített) kimenet, nem nyers
      transzkript — a `src/config.ts` invariánssal összhangban (`box-policy` spec)
- [ ] 8.3 A `box-policy` „mandate is independent of zone" követelményre építve: a narráló doboz egy
      `public`/`both`-zónás doboz, aminek a megbízása a narráció

## 9. Lezárás

- [ ] 9.1 `CLAUDE.md`: a wall szekció — a redakció, a fail-closed alapelv (az egyetlen fail-closed hely)
- [ ] 9.2 `npm run build` és `npx vitest run` zöld
- [ ] 9.3 **Adverzariális verifikáció**: független verifikátorok azzal a mandátummal, hogy cáfolják —
      minden reprodukált támadás lezárva, új nem nyílt. **Csak ennek sikere után** kapcsolható be a
      publikus narráló doboz a default configban.
