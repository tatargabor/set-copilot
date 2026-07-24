## Context

Ez a change egy beszélgetésből nőtt ki, aminek a mérési kiindulópontja load-bearing: a fork-alapú
producer **16–62 s / 47–76k token** egy rajzért, a közvetlen `wall-emit` ~1 s. A rajz tehát lassú, és
mire kész, a beszélgetés továbbment. A jelen change ezt a latenciát próbálja eltüntetni a felhasználó
szemszögéből — nem a producer gyorsításával, hanem azzal, hogy **előbb kezd rajzolni**, a `silence`-
ablakban, a beszélgetés valószínű következő lépésére.

A tervezés egyetlen kényes pontja, hogy a predikció **találgatás**, a fal pedig tekintélyt hordoz. A
projekt alapelvei (`SKILL.md`, `CLAUDE.md`) tiltják a találgatás publikálását: *„A wall carries
authority; don't lend it to a guess."* A feloldás nem új mechanizmus, hanem a `wall-layout-and-box-
policy`-ben landolt **zóna-modell** kihasználása: a predikció a privát zónában készül, és csak kapun
át publikálódik. A `silence` esemény már ma is „mélyebb lookup" pillanat — ez a change a szünetet
felkészülési ablakká teszi.

Egy piaci megfigyelés is alátámasztja az irányt (két korábbi versenytárs-kutatásból): a legközelebbi
rokon, a **DrawDash / Proactive Agentic Whiteboards** (arxiv 2025) pont ezt a mintát csinálja —
hallgat, szándékot detektál, **felajánl** egy kiegészítést, a user **elfogadja**. Nem autonóm
publikálás, hanem felajánlás + emberi jóváhagyás. A helyes forma tehát nem egyedi találmány; a
kutatás is ide konvergál, és a mi különbségünk a repó-grounding és a szállított jelleg marad.

## Goals / Non-Goals

**Goals:**

- A `silence`-ablak felkészülési ablakká tétele: rövid trajektória-extrapoláció, ami a felkészülést
  vezérli.
- Privát staging: a prediktív vizuál/súgás `zone: "private"`, a publikus falra nem megy magától.
- Olcsó, ember/szabály-vezérelt promote-kapu.
- Elévülés a fel nem használt predikcióra.
- A prediktív mandátum mint box-policy (config), nem motor-kód.

**Non-Goals:**

- **Publikus autonóm predikció.** A rendszer nem rajzol és nem mond magától a publikus zónába egy még
  el nem hangzott jóslatot. Ez alapelvet sért, nem egy paraméter — nem opció, nem config-kapcsoló.
- A producer gyorsítása vagy modelljének cseréje. A fork marad; ez a change a latenciát *elrejti*, nem
  csökkenti.
- Távoli/hosszú távú jóslás. Az extrapoláció egy-két lépés; a távoli jóslás pontatlan és zavaró.
- Új capture- vagy transzkripciós út. A `silence` eseményt használjuk, nem gyártunk újat.
- Publikus narráció/redakció bevezetése. Az a `wall-public-redaction` tárgya; itt csak *találkozunk*
  vele, ha egy promotolt vizuál `both`-zónás.

## Decisions

### D1 — A predikció privát; a publikus autonóm predikció kizárt

A prediktív tartalom `zone: "private"`, és csak promote-kapun át kerül publikusra. A publikus zónába
autonóm predikció **soha** nem megy.

*Alternatíva:* a magabiztos predikciók egy küszöb felett automatikusan a falra kerülnek. Elutasítva: a
küszöb nem old meg semmit — egy magabiztos téves jóslat a legrosszabb eset, mert épp azt hisszük el.
A fal tekintélye nem valószínűségi kérdés; egy még el nem hangzott állítás nem kap publikus teret. Ez
a change gerince, nem egy hangolható paraméter.

### D2 — A `silence` a felkészülés ablaka, nem új esemény

A meglévő `silence` eseményt használjuk hookként. A szünet az a pillanat, amikor a producernek van
ideje előre dolgozni, és amikor a felkészülés nem versenyez a reaktív úttal.

*Alternatíva:* folyamatos háttér-predikció minden mondat után. Elutasítva: megsokszorozza a spekulatív
token-költséget (a producer már drága), és a reaktív úttal versenyez. A szünet természetes, olcsó és
elég gyakori jelzés.

### D3 — A staging egy privát vizuál, a promote egy zóna-emelés

A prediktív rajz kész privát vizuálként áll a staging-dobozban. A promote nem újrarajzol, hanem a
meglévő vizuált a publikus zónába emeli (a `show`/emit nagyságrendjében, ~1 s).

*Ára / kapcsolódás:* ha a `wall-public-redaction` már landolt, a promotolt `both`-zónás vizuál a
delta-szintű zónára és a redakcióra ugyanúgy ráfut, mint bármely publikus esemény. A két change itt
találkozik, de nem függ egymástól: redakció nélkül a promote csak `private`→`public` tiszta vizuálokra
biztonságos, redakcióval `both`-ra is.

### D4 — Az elévülés kötelező, nem opcionális takarítás

Egy fel nem használt predikció elévül (időablak vagy bizonyított divergencia), és a privát nézetben
jelölve elengedődik. Elévülés után **nem** promotolható.

*Indok:* egy staged jóslat, ami ott ragad, két bajt okoz — vizuális zaj a privát nézetben, és a
kockázat, hogy egy elavult predikció később, rossz kontextusban promotolódik. Az elévülés mindkettőt
zárja.

### D5 — A mandátum box-policy, a mechanizmus motor

A „mit érdemes előre felkészíteni" a privát doboz policyjében él (config); a „hogyan" (silence-hook,
staging, promote-kapu, elévülés) a motorban. Ugyanaz a seam-elv, mint a `copilot.*` policynál.

*Indok:* a package több projektben fut. Hogy egy adott projektben mi a „valószínű következő lépés",
domain-tudás — configba tartozik, nem `src/`-beli logikába. A motor csak a keretet adja.

## Risks / Trade-offs

- **[Spekulatív munka = kidobott token]** → A producer már drága; a predikciók egy része sosem kerül
  elő. Enyhítés: csak `silence`-ablakban, csak privátba, olcsó promote. A staging-fork ne olvasson
  forrást, ha a privát mandátum elég pontos (a mérés szerint a forrásolvasás a drága ág).
- **[Téves predikció]** → Privátban egy rossz jóslat elvethető súgás, nem publikus baklövés. Az
  elévülés a vizuális zajt takarítja. Ez pont miért marad privát.
- **[A promote emberi lépés súrlódást ad]** → Egy megerősítés kell a publikáláshoz. Cserébe a fal
  sosem hazudik. A szabály-vezérelt kapu (a beszélgetés eléri a témát) a súrlódást csökkentheti, ahol
  a kockázat alacsony — de a default a megerősítés.
- **[Kísérteties felhasználói élmény]** → Ha a privát nézet tele van jóslattal, tolakodó lehet. Enyhítés:
  kevés, releváns predikció (a drawing-conventions „kevés csomópont, ami az érvet viszi" elve ide is
  áll), és az elévülés.

## Migration Plan

1. A `silence`-hook kiterjesztése a `SKILL.md`-ben: a szünet felkészülési ablak; a staging-fork
   mandátuma egy soros, a promote mechanikája leírva.
2. A privát staging-doboz a `DEFAULT_WINDOWS`-ban; a prediktív mandátum a doboz policyjében
   (`copilot-prompt` rendereli).
3. A promote mint zóna-emelés a `server.ts`-ben; az elévülés kezelése.
4. Szerveroldali teszt a kulcsinvariánsra: egy még el nem hangzott predikció sosem ér publikus klienst
   automatikusan; a promote helyes zóna-emelés; az elévülés zár.
5. `CLAUDE.md`: a „prepared, not published" minta.

**Rollback:** a privát staging-doboz eltávolítása a `DEFAULT_WINDOWS`-ból kikapcsolja a képességet a
promote/elévülés kód eltávolítása nélkül; a fal tisztán reaktív marad.

## Open Questions

- **A promote default kapuja.** Emberi megerősítés mindig, vagy egy szabály-vezérelt auto-promote is
  megengedett, amikor a beszélgetés bizonyítottan eléri a témát (és a vizuál `private`→`public`, nem
  `both`)? A biztonságos default a megerősítés; az auto-promote opt-in lehet.
- **Az elévülési ablak.** Fix idő, `silence`-számláló, vagy trajektória-divergencia méréssel? A
  legegyszerűbb egy idő + „új téma" jelzés; a divergencia-mérés pontosabb, de bonyolultabb.
- **A trajektória-extrapoláció forrása.** Tisztán a session ítélete (a beszélgetés kontextusából), vagy
  a keyword-index/knowledge is jelezhet valószínű következő témát? Az előbbi egyszerűbb és elég lehet.
- **Interakció a `both`-zónás staginggal.** Érdemes-e egyáltalán `both`-zónás vizuált stagelni, vagy a
  staging mindig `private`, és csak a promote dönt a cél-zónáról? Az utóbbi tisztább.
