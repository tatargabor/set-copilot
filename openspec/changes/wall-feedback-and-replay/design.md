## Context

A `monitor-wall-display` megépítette a kijelzőt és a producer-agnosztikus event-source varratot; a
`wall-producers` (D9) eldöntötte, hogy a **fő Opus session** érti meg és emittálja a spec-eket. Egy
élő teszt után kiderült: a dróton minden működik, de az **élmény** töröttnek látszott. Az ok nem
kódhiba egyetlen helyen, hanem **négy be nem teljesített tervezési tétel** — ezek gyökere és
lezárása ez a change tárgya.

A vezérlő felismerés: **a fal önmagában nem elég visszajelzés.** Egy copilot, ami csak feldolgozott
vizuálokon szól és különben néma, megkülönböztethetetlen a törötttől, ha (i) a vizuál nem frissül a
felhasználó képernyőjén, vagy (ii) épp hozzá beszélnek. A szerver-oldali „működik" bizonyíték nem a
felhasználó élménye.

## Goals / Non-Goals

**Goals:**
- A **chat↔fal viszony** explicit megtervezése: chat = elsődleges hang, fal = másodlagos artefaktum.
- A **state-replay teljessé tétele**: scroll-history + állapot-újraépítés a kanonikus JSONL-logból.
- A **böngészős verifikáció** kötelező kapuvá tétele (a headless vakfolt lezárása).
- **Élő latency-mérés** rögzítése.

**Non-Goals:**
- Új megjelenítési primitív, új kategória-típus vagy új render (az a display-modell, kész).
- A kétszereplős meeting rendszer-hang beállítása (külön, platform-függő feladat).
- A Haiku-offload út (az `wall-producers` archív D9 szerint opcionális marad).
- Perzisztencia a session után / felvétel-visszajátszás.

## Decisions

### D1 — Chat = elsődleges hang, fal = másodlagos artefaktum

A copilot **elsődleges csatornája a chat**; a fal a letisztult, kivetíthető vizuál. Amikor a copilot
a falra tesz valamit, **röviden a chatben is jelzi, mit értett meg** (nem a nyers szöveget — a
kiemelést/értelmezést). Amikor **közvetlenül hozzá beszélnek** vagy épp dolgozik, a chat rövid
nyugtázást ad — a fal **soha nem az egyetlen** visszajelzés.
**Miért:** az élő teszt bizonyította, hogy a néma-fal-only modell töröttnek látszik. A liveness- és
értelmezés-jelzés a chat dolga; a fal a lassabban változó artefaktumé.
**Alternatíva (elvetve):** szigorú „no filler, csak a falra" — ez okozta a hibát; egy közvetlenül
megszólított copilot némasága nem „tiszta", hanem halottnak tűnik.
**Fontos határ:** ez NEM a „no filler" elv eldobása többszereplős meetingen — ott a chat továbbra is
csak kategória-tüzeléskor szól. Ez a **közvetlen megszólítás** és a **saját fal-emisszió nyugtázása**
esetére nyit egy szűk, config-vezérelt visszajelzési rést. A mérték a `copilot.*` seamben él.

### D2 — Bizonytalan értelmezés a chatben kérdés, nem a falon tény

Ha a kinyerés többértelmű (pl. „4-szer ennyi / fele ennyi" → melyik bázisra?), a copilot **a chatben
jelzi a feltevését** vagy rákérdez, és csak azután (vagy jelölt feltevéssel) rakja a falra.
**Miért:** az élő tesztben megtippelt évek-chartot tényként raktam ki — ez félrevezet. A fal
tekintélyt sugall; tippet nem szabad tekintélyként megjeleníteni.

### D3 — State-replay: scroll-history + újraépítés a JSONL-ből

A csatlakozáskori replay a gráf-állapot + kitűzött latest-ek **mellé** a scroll-kategóriák **utolsó N
sorát** is elküldi (N config). Induláskor a szerver az **akkumulált állapotot a kanonikus
`wall-events.jsonl`-ból építi újra** (nem csak memóriából) — a `monitor-wall-display` D7 ígéretének
(„újraindításnál az állapot a fájlból újraépíthető") tényleges beváltása.
**Miért:** a feloldatlan Open Question csendben a „nincs scroll-replay" defaultra esett → néma fal
újracsatlakozáskor. Az élő teszt szerver-újraindítása + log-ürítése pont a rebuild hiányán bukott.
**Alternatíva (elvetve):** memória-only állapot — egy újraindítás mindent elveszít; a fájl a
kanonikus log, épüljön belőle.
**Következmény (üzemeltetési szabály):** élő használat alatt a `wall-events.jsonl`-t **tilos üríteni**
és a szervert **tilos menet közben újraindítani** — új menethez új runtime-dir vagy tudatos archiválás.

### D4 — A böngészős verifikáció kötelező kapu (a headless vakfolt lezárása)

A wall-iteráció **nem kész**, amíg egy ember a böngésző előtt le nem futtat egy checklistet:
reconnect (szerver-újraindítás nélkül is: tab-újratöltés) után a **helyes** állapotot látja-e; egy
élő chart-frissítés **rárendelődik-e**; a paced-swap/dwell/override érzet; a gráf-append; a
zóna-szűrés `/` vs `/wall`. A headless SSE-próba **nem** helyettesíti — épp ezt a réteget nem fedi.
**Miért:** a `monitor-wall-display` task 7.3/7.4 pont ezt írta elő, és üresen shippeltük; a mostani
hiba ott élt. A verifikáció-koncepció legyen explicit kapu, ne „nice to have".

### D5 — Élő latency-mérés, rögzített számokkal

A modalitásonkénti latency **mért** szám legyen (szöveg: emisszió→render-hop; gráf/chart:
spec-emisszió→render), stabil, nem-újraindított szerveren rögzítve — nem a kutatás becslése.
**Miért:** a `wall-producers` egésze a latencyről szólt (fő session a hot-pathon), és sosem mértük;
a D9 (Opus emittál) valódi költsége mérés nélkül ismeretlen.

## Risks / Trade-offs

- **[A chat-nyugtázás visszahozza a fillert]** Ha a D1 rés túl tág, a copilot fecseg. →
  *Mitigáció:* a mérték `copilot.*` config; a default szűk (közvetlen megszólítás + saját
  fal-emisszió nyugtázása), többszereplős meetingen a kategória-policy változatlan.
- **[JSONL-rebuild lassú nagy lognál]** Sok esemény újraolvasása induláskor költséges. →
  *Mitigáció:* a rebuild csak az akkumulált állapotot számolja (nem broadcastol); nagy lognál a
  scroll-history N-re vágva, a gráf a shown-vizuálra szűkítve.
- **[Scroll-ring-buffer memória]** Végtelen scroll-history nőne. → *Mitigáció:* fix N/ kategória.
- **[A böngészős kapu emberi figyelmet igényel]** Nem automatizálható. → *Mitigáció:* ez a
  tudatos ára a valós érzet ellenőrzésének; a checklist rövid és megismételhető.

## Open Questions

- **N értéke a scroll-historyra** — kategóriánként hány sor replay-eljen? (default-javaslat: 20.)
- **A chat-nyugtázás mértéke config-mezőként** — új `copilot.acknowledge`/`copilot.verbosity` mező,
  vagy a meglévő `engagement` egy szintje fedi le?
- **A JSONL-rebuild és a live-tail versenye** — a startup-rebuild és a `jsonlTailSource` visszajátszás
  ne dolgozza fel kétszer ugyanazt a sort (offset/egyszeri-feldolgozás garancia).
