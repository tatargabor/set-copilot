## 1. `narráció` kategória és privát doboz (config)

- [x] 1.1 `src/config.ts`: új `narráció` (💬, `render: "text"`) a `DEFAULT_CATEGORIES`-be (D1)
- [x] 1.2 `src/config.ts`: a `DEFAULT_WINDOWS` privát nézetének szövegdoboza iratkozzon fel a `narráció`-ra
      (a `riasztás`/`súgás` mellé), a `zone: "private"` megtartásával
- [x] 1.3 Teszt (`src/config.test.ts`): a `narráció` kategória feloldódik és a privát doboz `cats`-ében van;
      projekt felül tudja írni/átnevezni (config-merge)

## 2. Verbosity-kar a policyben (config → prompt)

- [x] 2.1 `src/config.ts`: `copilot.narration` konfig (`enabled` + `verbosity` szint + opcionális `maxLines`),
      merge-eléssel és validációval (rossz/hiányzó → default; alap: bekapcsolt, a mainél hangosabb) (D2)
- [x] 2.2 `src/copilot-prompt.ts`: a narráció-mandátum renderelése — „batch-enként / `silence`-re egy
      **tartalmi** sor a `narráció` dobozba; ha nincs mit mondani, ne emitálj" (D2, D4); a `## Engagement`
      és `## Feedback` szekciókkal összehangolva (a narráció ortogonális az engagementhez)
- [x] 2.3 A NO-FILLER kimondása a mandátumban: tilos „figyelek"/„várok"/nyers-transcript-ismétlés (D4)
- [x] 2.4 Teszt (`src/copilot-prompt.test.ts`): bekapcsolt narrációnál a mandátum + a `narráció` doboz-policy
      renderelődik; **kikapcsolva a kimenet bit-azonos a mai reactive kimenettel**

## 3. A mechanika a skillben

- [x] 3.1 `skills/meeting-copilot/SKILL.md` Phase 4/5: batch-enként (és `silence`-re) egy tartalmi
      narráció-sor közvetlen `wall-emit`-je a privát `narráció` dobozba (`zone:"private"`), fork nélkül (D3)
- [x] 3.2 A cadence-korlát kimondása: legfeljebb batchenként egy sor; nem tokenenként, nem alertre várva
- [x] 3.3 A narráció és az alert-output elkülönítése a skillben (a narráció nem helyettesíti az ⚠/📋/✏/❓-t)

## 4. Ellenőrzés

- [x] 4.1 `npm run build` + `npm test` zöld
- [x] 4.2 Élő próba: `set-copilot wall` + `set-copilot prompt` — a narráció-mandátum jelen; batchekre a privát
      `narráció` doboz folyamatosan, tartalmi sorokkal frissül, alertek ettől függetlenül tüzelnek
- [x] 4.3 Regresszió: kikapcsolt narrációnál `set-copilot prompt` kimenete változatlan
