# A nyilvános fal: közönség és zóna két külön tengely

Ez a lap arról szól, hogyan mutass **többet** a megosztott falon anélkül, hogy bármi
biztonsági jellegűhöz hozzányúlnál. Röviden: a `boxes` a "mit mutat", a `zones` a "mit
_szabad_ mutatnia", és az `audience` a "ki nézi". A háromból csak az utolsó kettő kapcsol
védelmet — és a `zones` bővítése **soha többé nem** kapcsol ki semmit.

## A két tengely

| mező | mire válaszol | hol él |
|---|---|---|
| `zone` (`private` / `public` / `both`) | mehet-e ez a *tartalom* közönség elé? | az eseményen, a producer küldi |
| `audience` (`public` / `operator`) | van-e élő közönség ez előtt az *ablak* előtt? | az ablakon, a configban |

A kettő nem ugyanaz, és korábban egyetlen mező csinálta mindkettőt: a szerver abból
következtetett a közönségre, hogy az ablak `zones` listájában szerepel-e a `private`.
Ez működött, amíg a két szállított ablak véletlenül egybeesett — és abban a pillanatban
elromlott, amikor valaki a nyilvános fal `zones` listáját bővítette, hogy többet mutasson:
azzal némán **kikapcsolta a kitakarást** egy élő közönség előtt.

Amit ebből meg kell jegyezni:

- **A `zone: "private"` továbbra is az egyetlen megbízható tartalomkapu.** A kitakarás
  (`wall.redaction`) mintaillesztő, nem osztályozó — nem az áll egy belső részlet és egy
  terem között.
- **Az `audience: "operator"` nem hozzáférés-védelem.** Azt mondja meg, hogy ez a
  megjelenítő nem közönség előtt áll; nem azt, hogy más nem láthatja.
- **Ha többet akarsz mutatni a falon, adj hozzá dobozt** (`boxes`), és a producer küldje az
  adott tartalmat `zone: "both"`-tal. A `zones` lista bővítése nem erre való.

## Az alapértelmezés fail-closed

Egy ablak, amelyik nem mond `audience`-t — vagy olyat mond, amit a motor nem ismer —
**publikusnak** minősül: kitakarás bekapcsol, privát zónás esemény nem jut el hozzá.

Ez tudatosan a *korábbi* következtetés ellenkezője. Egy fal, amelyik kitakart valamit,
amit nem kellett volna, bosszantó; egy fal, amelyik nem takart ki, pont az, ami ellen ez az
egész létezik.

Ezért egy régebbi projekt-config saját privát ablaka a frissítés után **több** kitakarást
kap, mint előtte, és a szerver figyelmeztet, megnevezve az ablakot és az egymezős javítást:

```
[set-copilot] wall: window "én" renders private-zone events but declares no audience —
treating it as PUBLIC (redaction on, private events withheld).
Add `"audience": "operator"` if this is your own view.
```

Ha az `audience` és a `zones` ellentmond egymásnak (pl. `"operator"`, de nincs `private`
a zónái közt), a szerver figyelmeztet, és a **védettebb** olvasat nyer.

A két szállított ablak explicit módon deklarál (`én` → `operator`, `fal` → `public`), így
egy alap-telepítés viselkedése változatlan.

## A paritás konfiguráció, nem motor

Az alábbi két alak mindent lefed, amit a "lássa a fal is, amit én látok" igény kér. Egyik
sem új képesség — mindkettő csak config.

### A) Egy nyilvános fal a tükörrel, a narrációval és a kitűzött dobozzal

Ez a szállított `fal` ablak alakja; ide másolva azért, hogy legyen mit bővítened:

```jsonc
{
  "wall": {
    "windows": [
      {
        "name": "fal",
        "route": "/wall",
        "zones": ["public", "both"],
        "audience": "public",
        "layout": "három-régió",
        "boxes": {
          "szöveg":      { "behavior": "scroll", "cats": ["narráció", "tükör"],
                           "policy": { "engagement": "reactive", "maxLines": 2,
                                       "instructions": "Ez a nyilvános narráló doboz — élő közönség láthatja. Foglald össze tömören, közönség-barátul, amiről szó van; ne a nyers átiratot közvetítsd. Belső részletet SOHA ne írj ki nyersen: jelöld `[belső]`-vel (a szerver kitakarja), vagy hagyd ki. Kétség esetén hagyd ki." } },
          "prezentáció": { "behavior": "latest", "cats": ["architektúra", "metrika", "előrejelzés"],
                           "pacing": { "minDwellMs": 8000, "crossFadeMs": 400 } },
          "kitűzött":    { "behavior": "latest", "cats": ["kitűzött"],
                           "policy": { "instructions": "Ez a KITŰZÖTT doboz — ami ide kerül, ott is marad. Napirend, nyitott kérdések, rögzített döntések. A teljes blokkot küldd ki mindig, mert cserél, nem fűz hozzá." } }
        }
      }
    ]
  }
}
```

Bővítés: vegyél fel egy negyedik dobozt egy másik kategóriára, vagy adj kategóriát egy
meglévőhöz. A `zones` marad `["public", "both"]` — nincs miért hozzányúlni.

### B) Csak nyilvános ablak, privát nélkül

Ha a gép egyetlen dolga a kivetítő hajtása (a copilot máshol fut), egy ablak elég:

```jsonc
{
  "wall": {
    "windows": [
      {
        "name": "fal",
        "route": "/",
        "zones": ["public", "both"],
        "audience": "public",
        "layout": "third-two-thirds",
        "boxes": {
          "szöveg":      { "behavior": "scroll", "cats": ["narráció", "tükör"],
                           "policy": { "engagement": "reactive", "maxLines": 2,
                                       "instructions": "Nyilvános narráció: tömör, közönség-barát összefoglaló. Belső részlet `[belső]` jelöléssel vagy sehogy." } },
          "prezentáció": { "behavior": "latest", "cats": ["architektúra", "metrika"],
                           "pacing": { "minDwellMs": 8000, "crossFadeMs": 400 } }
        }
      }
    ]
  }
}
```

Itt nincs `staging` doboz, mert nincs privát zóna, ahová előre lehetne rajzolni: egy
jóslat definíció szerint privát, amíg valaki fel nem emeli. Ez az alak tehát lemond a
prediktív felkészítésről — cserébe nincs olyan felület, amit véletlenül ki lehetne
vetíteni.

## Paritás = ugyanaz a **doboz**, nem ugyanaz a **folyam**

Ez az a mondat, ami miatt a paritás nem az, aminek elsőre hangzik.

Ha felteszed a tükör-dobozt a nyilvános falra, akkor azt látod ott, ami **megosztott
zónába** ment ki és **túlélte a kitakarást** — nem az operátor privát súgófolyamát. A
doboz ugyanaz, a benne folyó tartalom nem.

Ez általában pont az, amit valójában akarsz: a chat érdemi része a falon, a "figyelj, ez
ellentmond a DEC-004-nek" pedig nem. Ha valami mégis hiányzik a falról, a javítás mindig
ugyanaz: a *producer* küldje azt a tartalmat `zone: "both"`-tal — nem az ablak zónalistáját
kell tágítani.

---

Kapcsolódó: a kitakarás taxonómiája `wall.redaction` (config), a mechanizmusa
`src/wall/redaction.ts` (motor); a megjelenítési modell (ablak → layout → pozíció → doboz)
a gyökér `CLAUDE.md`-ben.
