## Context

Ez a change egy **elhalasztott** képességet épít újra, nem zöldmezős tervezés. Az előtörténet
load-bearing, ezért itt rögzítjük.

A `wall-layout-and-box-policy` eredetileg tartalmazta az automatikus publikus-zóna redakciót. Megépült
egy mezőlistás takarító (`redactForPublic`), szerveroldali beépítéssel és privát-nézet-jelöléssel.
Ezután négy független adverzariális verifikátor futott rá, mind azzal a mandátummal, hogy **cáfolja**.
A találatok mind **reprodukáltak** voltak:

1. **Mezőlista-szivárgás.** A takarító felsorolt mezőket tisztított, de a `DisplayEvent` payloadja
   nyitott (`GraphNode` és `ChartDatum` explicit `[k: string]: unknown`). Bizonyítva ment ki
   érintetlenül: `nodes[].secretNote`, `chart.unit`, `chart.data[].note`, `node.id`.
2. **URL-szivárgás.** Az `image.src` / `webpage.url` nem volt takarítva. Bizonyítva: a `webpage.title`
   redaktálva ment, de az URL query-jében ugyanaz a token publikálódott.
3. **Replay zóna-mosás.** Az akkumulált gráf egy zónát tárolt vizuálonként, és a *legutolsó* delta
   zónájával írta felül. Bizonyítva: két `private` delta + egy `both` delta után egy publikus kliens
   megkapta a privát csomópontokat is.
4. **Szűretlen `show`.** A `visual` id szabad producer-szöveg, szűretlenül ment minden klienshez.
   Bizonyítva: egy `private` gráf `visual:"[internal] project-hush"` id-je megjelent a publikus
   kliensnél.
5. **ReDoS.** A config-minták komplexitás-korlát nélkül futottak; mérve `(a+)+$` 30 karakteren 9091 ms.
6. **Credential-minta hibák.** A `\S+` illesztett `api_key:`-re a titkot hagyva; a `.*` megállt
   soremelésnél.

A tanulság nem „javítsuk a mintát". A redakció mint **utólagos szűrő egy nyitott payloadon**
architekturálisan rossz volt. Az akkori döntés (a felhasználó választása): a fal maradjon **privát**,
a redakció külön changebe, rendes tervezéssel. Ez az a change.

A biztonsági **alapréteg** a `wall-layout-and-box-policy`-ből landolt, és ezt feltételezzük: `/media`
confinement (`realpath` + allowlist), loopback binding, ingest-validáció a megosztott funnelben,
ablak-kategória szűrés a broadcaston. Ez a change erre épít.

## Goals / Non-Goals

**Goals:**

- A `both`-zónás események mély, rekurzív takarítása a publikus zónába menet előtt, minden reprodukált
  szivárgást lezárva.
- URL-forrásra visszatartás (nem tisztítás).
- Delta-szintű zóna a replayben.
- A `show` zónázása.
- Fail-closed hibakezelés és ReDoS-korlát.
- A publikus narráló doboz visszahozása, feldolgozott (nem nyers) kimenettel.

**Non-Goals:**

- A biztonsági alapréteg újraépítése (az a `wall-layout-and-box-policy`-ben landolt).
- Nyers transzkript a falra. A narráció feldolgozott kimenet marad.
- Kliensoldali redakció. A takarítás szerveroldalon, broadcast előtt történik — a kliens sosem lát
  redaktálatlan `both`-eseményt.
- Titkosítás vagy hitelesítés a fal-kliensek felé. A fal lokális; a zóna a határ.

## Decisions

### D1 — Rekurzív string-levél takarítás, nem mezőlista

A takarító a payload-fát járja be, és **minden string-levélre** alkalmazza a mintákat, tetszőleges
mélységben és kulccsal. Egy nem-string levelet (szám, bool) nem érint.

*Alternatíva:* bővített mezőlista. Ez volt a bukott megközelítés — a payload nyitott (`[k]: unknown`),
egy lista sosem teljes. Egy új producer egy új kulccsal újranyitja a rést. A rekurzív bejárás az
egyetlen, ami zárt a *jövőbeli* kulcsokra is.

*Ár:* a takarító nem tudja megkülönböztetni a „tartalom" stringet a „strukturális" stringtől (pl. egy
`op: "reset"`). Ez elfogadható: egy vezérlő-string mintára illeszkedése ritka, és a fail-closed default
mellett a rossz irány a visszatartás, nem a szivárgás.

### D2 — URL: illeszkedés → visszatartás, nem tisztítás

Ha egy minta illeszkedik az `image.src` vagy `webpage.url` bármely részére, a **teljes esemény**
visszatartva a publikus zónából. Az URL nem tisztítható részlegesen (a query-token kivágása vagy
elrontja az URL-t, vagy nyomot hagy), ezért a bináris döntés — megy vagy nem megy — az egyetlen
biztonságos.

*Alternatíva:* query-paraméterek szelektív törlése. Törékeny (nem minden titok query-ben van; a path
is hordozhat id-t) és hamis biztonságérzetet ad. A visszatartás egyszerű és bizonyíthatóan zárt.

### D3 — Zóna a delta szintjén, a replay deltánként szűr

Az akkumulált gráf minden deltához eltárolja a saját zónáját. A replay egy csatlakozó kliensnek csak
azokat a deltákat játssza vissza, amelyek zónája a kliens zónájával kompatibilis. A „vizuál egy zónát
hordoz" modell megszűnik.

*Alternatíva:* a vizuál első deltájának zónája dönt. Ez szigorúbb (a privát-kezdetű vizuál sosem megy
publikusra), de eldob legitim `both` deltákat egy privátban indult vizuálon. A delta-szintű szűrés
pontosabb, és pont a reprodukált mosást zárja.

### D4 — A `show` a vizuál zónájára szűrve megy ki

A `show` parancs a hivatkozott vizuál zónáját örökli, és csak a kompatibilis zónájú klienseknek megy
ki. A `visual` id maga is érzékeny lehet (a reprodukált eset: `[internal] project-hush`).

### D5 — Fail-closed, a projekt szokásos mintájától eltérve

Ha a redakció hibázik (minta-fordítás, időtúllépés, váratlan payload-alak), az esemény **nem** megy a
publikus zónába. A privát megkaphatja. Ez tudatos eltérés a „dobd el és menj tovább" mintától: itt a
továbbmenés a szivárgás. A dokumentációban (kód-komment + `CLAUDE.md`) explicitté tesszük, hogy ez az
egyetlen hely, ahol a fal fail-closed.

### D6 — ReDoS: statikus elutasítás config-időben + futásidejű korlát

A config-minták betöltéskor statikus ellenőrzésen mennek át (katasztrofális visszalépés gyanús
konstrukciói, pl. egymásba ágyazott kvantor), és futásidőben időbüdzsé alatt futnak. Az elv: egy
esemény sem foghatja meg a szerver egyetlen szálát.

*Nyitott a részlet:* tiszta regex-időkorlát Node-ban nem triviális (nincs natív timeout). Lehetőségek:
(a) statikus lint + hossz-korlát az inputon, (b) `re2` jellegű lineáris motor a felhasználói mintákra,
(c) worker-thread időkorláttal. A `re2` a legtisztább (lineáris garancia), cserébe egy natív függőség.
A tervezés eldönti — a spec csak a *korlátozottságot* követeli, a mechanizmust nem.

### D7 — Megfigyelhetőség payload-típustól függetlenül

A redaktált-jelölés a `DisplayEvent` szintjén ül (nem a szöveg-payloadon belül), így egy redaktált
gráf-címke, chart-cím vagy kép-felirat is jelet kap a privát nézetben. Az operátor mindig látja, mit
nem látott a közönség.

### D8 — A `[belső]` konvenció tanítása a producernek

A default minta ma egy `[belső]` jelölésre épül, amit a producer sehol nem tanul meg (fantom-konvenció:
sem a `renderDrawingContract`, sem a `SKILL.md` nem említi). Vagy tanítsuk meg a `copilot-prompt`-ban és
a drawing-kontraktusban, vagy vegyük ki a mintát. A döntés: **tanítsuk meg** — a producer inherited
kontextusa a legjobb hely rá, és a jelölés olcsó, explicit operátor-vezérlést ad.

## Risks / Trade-offs

- **[A tét a legmagasabb: belső adat nyilvános falon]** → Minden szcenárió reprodukált támadásból ered;
  fail-closed default; kötelező szerveroldali és adverzariális verifikáció a landolás előtt. A fal
  privát marad, amíg ez nincs igazolva.
- **[A rekurzív takarítás vezérlő-stringre is illeszkedhet]** → Egy `op`/`kind` string mintára
  illeszkedése visszatartáshoz vezet (fail-closed). Bosszantó, de biztonságos; enyhítés: a default
  minták szűkek és jelölés-alapúak (`[belső]`), nem generikus szórásúak.
- **[ReDoS-mechanizmus vs. natív függőség]** → Az `re2` lineáris garanciát ad egy natív függőség árán;
  a statikus lint + input-korlát függőség-mentes, de gyengébb. A tervezés méri.
- **[A narráció közel áll a nyers transzkripthez]** → A spec kimondja: feldolgozott, szűrt, tömörített
  kimenet. A `src/config.ts` invariáns nem sérül, de a producer-megbízásnak ezt explicitté kell tennie.
- **[Szerveroldali teszt nehézkes]** → A broadcast/replay/`show` út SSE-t és kliens-állapotot igényel.
  Az előző change `verify.mjs`-e (node ESM, valódi HTTP+SSE) a minta — ezt bővítjük redakciós esetekre.

## Migration Plan

1. `src/wall/redaction.ts`: rekurzív mély takarító + URL-visszatartás, tiszta logika, teljes teszttel a
   reprodukált szcenáriókra.
2. Delta-szintű zóna az akkumulált gráfban (`types.ts` + `server.ts`), a replay deltánként szűr.
3. A `show` zónázása.
4. A takarító beépítése az `ingest` funnelbe a broadcast előtt; fail-closed út.
5. ReDoS-korlát (a D6 eldöntött mechanizmusa).
6. Megfigyelhetőség: redaktált-jelölés minden payload-típuson.
7. `[belső]` konvenció tanítása a `copilot-prompt`-ban és a drawing-kontraktusban.
8. A publikus narráló doboz visszahozása a `DEFAULT_WINDOWS`-ba.
9. Szerveroldali + adverzariális verifikáció; csak utána a fal alapból nem-privát.

**Rollback:** a narráló doboz eltávolítása a `DEFAULT_WINDOWS`-ból visszaállítja a privát falat a
redakciós kód eltávolítása nélkül.

## Open Questions

- **A ReDoS-mechanizmus** (D6): `re2` natív függőség vs. statikus lint + input-korlát vs. worker-thread.
  A tervezés méri és dönt.
- **A narráció forrása.** A narráló doboz a `mic` beszélőt narrálja-e csak, vagy a `system` felet is?
  Egy meeting-copilot kontextusban a `system` (a másik fél) narrálása kényesebb — az ő beleegyezése
  nélkül publikus falra tenni a szavát külön megfontolást igényel.
- **A default minták forrása.** A `[belső]` jelölés operátor-vezérelt; kell-e emellé generikus
  név/PII-felismerés is, vagy az túl sok hamis visszatartást hoz? (Az előző change specje generikus
  névfelismerést ígért, de explicit listát szállított — ezt a feszültséget itt kell feloldani.)
