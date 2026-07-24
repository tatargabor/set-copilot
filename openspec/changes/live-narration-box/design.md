## Context

A visszaolvasott sessionök egybehangzó jelzése: a copilot `reactive` alapállása — „kategóriára szólalj meg,
egyébként hallgass" — élő közönség előtt halottnak látszik. A felhasználó nem több *riasztást* kér, hanem
**folyamatos, tartalmi kísérőszöveget**: mi zajlik, mihez kötődik. Ma ilyen csatorna nincs; a `súgás` doboz
csak akkor frissül, ha egy alert-kategória tüzel.

A projekt két alapelve feszül itt egymásnak, és mindkettőt tartani kell. Egyrészt **NO FILLER, EVER** —
„figyelek"/„várok" sor tilos. Másrészt a felhasználó *pont* azt kéri, hogy „folyamatosan írj". A feloldás
nem a NO-FILLER feladása, hanem a **tartalmi** narráció: minden sor mond valamit (téma, döntés, tudásbázis-
kapcsolat), és ha nincs mit mondani, a doboz a korábbi sorát tartja — a NO-FILLER így sértetlen.

A második feszültség: a `## Engagement` (silent/reactive/participant) a *chatben* mondott tartalomról szól,
és nem szabad túlterhelni. A narráció egy **wall-viselkedés**, külön kar — a kettő ortogonális, ahogy az
`acknowledge` (wall-echo/direct-address) is ortogonális az engagementhez (`config.ts`).

## Goals / Non-Goals

**Goals:**
- Dedikált, folyamatosan frissülő narráció-doboz a privát falon, az alert-taxonómiától elkülönítve.
- Konfigurálható bőbeszédűség (config, nem `src/`-logika), a mainél hangosabb alapértékkel, kikapcsolhatóan.
- A NO-FILLER garancia megtartása: minden narráció-sor tartalmi.
- Ütemes, nem elárasztó frissítés (batch-enként / `silence`-re).

**Non-Goals:**
- Az audio-/capture-/transcript-útvonal érintése (a narráció a meglévő poll-batchekből dolgozik).
- A narráció automatikus publikus falra emelése — az a zóna-modell + `wall-public-redaction` dolga.
- Az alert-taxonómia (⚠/📋/✏/❓) átszabása.
- Egy külön „narráció-fork" — egy tartalmi sorhoz nincs mit komponálni, közvetlen `wall-emit` a helyes.

## Decisions

- **D1 — Új `narráció` (💬) kategória, nem az alertek bővítése.** A narráció külön `text`-kategória, amire a
  privát szövegdoboz feliratkozik (`config.ts` `DEFAULT_CATEGORIES` + `DEFAULT_WINDOWS`). Így a narráció és az
  alertek szét vannak választva a fal szintjén is; egy alert nem nyomja el a narrációt és fordítva. Kategória
  = config, tehát projekt is hozzáadhat/átnevezhet.
- **D2 — A verbosity a policyben él, nem a motorban.** Egy `copilot.narration` konfig (pl. `{ enabled,
  verbosity }`, saját `maxLines`-szal) a `copilot-prompt.ts`-ben renderelődik a `## Engagement` / per-box
  policy mellé. A `renderCopilotPrompt` így egy explicit narráció-mandátumot ad: „minden batchre / szünetre
  írj egy tartalmi sort a `narráció` dobozba". Rossz/hiányzó érték → default (merge-mintázat, mint a többi
  `copilot.*`).
- **D3 — A mechanika a SKILL-ben, a döntés a configban.** A `meeting-copilot/SKILL.md` Phase 4/5 kap egy
  lépést: batch-enként (és `silence`-re) egy tartalmi narráció-sor közvetlen `wall-emit`-je a privát
  `narráció` dobozba (`zone:"private"`), fork nélkül. A „mit érdemes mondani" a mandátumból jön, nem a
  skillből.
- **D4 — NO-FILLER a spec szintjén.** A narráció-mandátum kimondja: ha nincs tartalmi mondandó, a doboz a
  korábbi sorát tartja (nincs új emit). A dobozt a `latest` viselkedés a legutóbbi soron tartja, tehát a
  „tartsd a régit" = egyszerűen nem emitálunk.
- **D5 — Privát alapértelmezés.** A narráció `zone:"private"`. A publikus falra emelés külön, redakció-kapuval
  — nincs autonóm publikus narráció (összhangban a `wall-public-redaction` fail-closed alapelvével).

## Risks / Trade-offs

- **Zaj vs. élet.** Túl sűrű narráció elárasztja a privát dobozt; a batch-enkénti/`silence`-korlát (spec-
  követelmény) és a `maxLines` tartja kordában. A `latest`+scroll doboz úgyis az újat felülre teszi.
- **Token-költség.** Batch-enkénti egy sor olcsó (közvetlen emit, nincs fork). A verbosity-kar engedi a
  költség-hangolást; kikapcsolva a viselkedés bit-azonos a maival.
- **NO-FILLER csúszás.** A „legyél bőbeszédűbb" könnyen tölteléksorrá silányul; a spec ezért explicit
  tiltja a nem-tartalmi sorokat, és ezt a mandátum-szöveg is kimondja — ez a change legkényesebb pontja.
- **Átfedés a `wall-predictive-staging`-gel.** Az prediktív *vizuált* stagel; ez folyamatos *szöveget* ír.
  Kiegészítők: a narráció a jelenről szól (privát), a staging a valószínű jövőről (privát) — ugyanabban a
  privát nézetben megférnek külön dobozként.
