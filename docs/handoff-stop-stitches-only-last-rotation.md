# Handoff — `stop` csak az UTOLSÓ rotációs darabot stitcheli

**Bejelentő:** `consumer-a` projekt (2026-08-01, éles ügyfél-megbeszélés)
**Státusz:** 🔴 **nyitott**
**Prioritás:** P1 — némán tudásvesztéssel jár; a hiány pontosan úgy néz ki, mint a siker.

---

## 1. A tünet

Egy 2,5 órás ügyfél-megbeszélés felvétele a **2 órás önkorlát** miatt két darabra esett. A
`stop` lefutott, hibát nem jelzett — de a **rotáció előtti** darabhoz nem készült sem
olvasható `.md`, sem mondat-szintű `-stitched.jsonl`. Csak a nyers, töredékes `.jsonl` maradt.

Mérve, ugyanabban a runtime-könyvtárban (`.set/copilot/<uuid>/`):

| fájl | mtime | mi történt |
|---|---|---|
| `transcript-2026-08-01T12-31-52-109Z.jsonl` | 14:31 | a rotációkor lezárult (1. darab) |
| `transcript-2026-08-01T12-31-52-109Z.md` | **15:25** | ⚠ **utólag, kézzel** pótolva |
| `transcript-2026-08-01T12-31-52-109Z-stitched.jsonl` | **15:25** | ⚠ ua. |
| `transcript-2026-08-01T13-01-15-561Z.jsonl` | 15:01 | a `stop` írta (2. darab) |
| `transcript-2026-08-01T13-01-15-561Z.md` | 15:01 | ✅ a `stop` stitchelte |
| `transcript-2026-08-01T13-01-15-561Z-stitched.jsonl` | 15:01 | ✅ ua. |

A `stop` tehát a `stitchOnStop` lépést **az aktuális (utolsó) transcriptre** futtatja, és a
rotáció során archivált korábbi darab(ok)ra nem.

## 2. Miért P1 — a hiány iránya a rossz

- **A `stop` kimenete sikernek látszik.** Három útvonalat ír ki, mind létezik. A hiányzó
  darabról **egy szó sem esik** — a hívónak (jelen esetben a `/meeting-copilot stop`
  fázisának) nincs miből észrevennie.
- **Az arány nem mellékes:** ebben az esetben a **nagyobbik és tartalmilag súlyosabb** rész
  esett ki — 16 691 szó a 20 668-ból (**81%**), és épp az, amiben az ügyfél kritikája, a
  bizonylat-út újratervezése és a telephely-témák elhangzottak. A `stop` a maradék 19%-ot
  stitchelte szépen.
- **Épp az ellen véd a `transcript-stitch` change**, amiért ez a rés visszahozza a problémát:
  a `docs/handoff-transcript-stitch.md` §1 mért esete pontosan az volt, hogy egy feldolgozó
  lépés a nyers `.jsonl`-t olvasta, „mert az volt kéznél". Egy hiányzó `.md` **ugyanoda
  vezet** — a következő lépés vagy a nyerset olvassa, vagy azt hiszi, nincs anyag.

## 3. Amit a fogadó oldal ma tenni kénytelen

A pótlás megvan és működik, de **kézi** és **utólagos** — vagyis csak akkor fut le, ha valaki
észreveszi a hiányt:

```bash
SET_COPILOT_DIR=$PWD/.set/copilot/<uuid> npx set-copilot transcript \
  --input .set/copilot/<uuid>/transcript-<a-korábbi-stamp>.jsonl
```

A `capture rotation repaired` jelzés helyesen megjelenik a kimeneten, és a szegmensekből
mondatok lesznek (mérve: 822 szegmens → 380 mondat). **A motor tehát jó — csak nem hívódik meg.**

## 4. Javaslat

A `stop` a **runtime-könyvtár összes olyan `transcript-*.jsonl`-jére** futtassa a stitchet,
amelyhez nincs `.md` / `-stitched.jsonl` — ne csak az aktuálisra. Ez idempotens (a meglévőket
átugorja), és a rotáció mellett a megszakadt/újraindított capture esetét is fedi.

Kiírásnál a `stop` **soronként** nevezze meg a darabokat, ne egy hármast — a hívó így látja,
hogy több rész van. Ma a három útvonal azt sugallja, hogy egy felvétel volt.

⚠ **A recovery-ledger önmagában nem elég erre.** A `recovery status` a *végigolvasást* méri
(drága, emberi lépés); ez viszont *mechanikus* előfeldolgozás, aminek a `stop`-on belül a
helye — különben a ledger olyan tételt vezet be, amihez a `.md` sincs meg.

## 5. Ami NEM ez a hiba — hogy ne fusson össze a kettő

Ugyanezen a napon a fogadó projektben hiányzott a **Claude Code session-export** is (a
felvétel mellett futó terminál-beszélgetés mentése). ⚠ **Az nem a rotáció következménye, és
nem is a `set-copilot` dolga:** az exportot a fogadó projekt saját szkriptje végzi
(`scripts/copilot-session-export.mjs`), és a `/meeting-copilot stop` fázisa **soha nem hívta
meg** — a SKILL.md `stop` szakasza csak a capture és a wall leállítását írja le.

Ez a fogadó oldalon van megoldva (session-indító mérés + kapu). Itt csak azért szerepel, hogy
a két hiba diagnózisa ne keveredjen össze: **rotáció → hiányzó `.md`**, **hiányzó hívás →
hiányzó `-session.md`**.
