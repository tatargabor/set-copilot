# A prezentáció mint tudásforrás

A copilot nem tudta megmondani egy előadónak, hogy épp ellentmondott a saját diájának,
mert a deck sosem volt a tudásában: a `knowledge.sources` csak `.md`-t old fel. A
`knowledge.deck` ezt a rést zárja be.

Ez nem ötlet volt, hanem **mérés**. A replay harness három valós idejű futásán pontosan
egy beültetett csapda maradt ki mindig: az előadó *12 milliárdot* mond, a deck *21,8
milliárdot* ír, és a teremben senki nem javítja ki.

## Beállítás

```json
{
  "knowledge": {
    "deck": ["docs/deck/*.html", "docs/deck.md"]
  }
}
```

Fájlok vagy globok; `.md`, `.txt`, `.html`, `.htm`. Üres alapból — deck nélkül minden
tudás-artifact bájtra azonos marad azzal, ami eddig volt.

## Nézd meg, mielőtt támaszkodsz rá

```bash
set-copilot deck
```

Kiírja a diákat sorrendben, címmel, és a belőlük kinyert számokat — plusz megnevezi, amit
nem sikerült kinyerni.

**Ezt olvasd el egy meeting előtt.** Egy át nem nézett kinyerés a legrosszabb irányba
hibázik: a copilot hallgat, és a hallgatás megkülönböztethetetlen attól a meetingtől, ahol
nem volt mit mondani.

## Amit a copilot ettől tud — és amit nem

**Tudja**, mit állítanak a diák, dia szerinti bontásban, és **idézni tudja a diát**: „a 11.
dia szerint 21,8 milliárd". Egy riasztás, ami a tudásbázisra hivatkozik, élő meetingen nem
használható; egy, ami a diára, az igen.

**Nem tudja**, melyik dia van épp a vetítőn. Nem látja a képernyőt — abból következtet,
amit hall. Ha egy dia szava elhangzik, a transcript sora megkapja azt a diát témaként, de
ez következtetés, nem érzékelés. Ne ígérd másnak.

**A dia-címkézés a címekre épül**, tehát a felismerése korlátozott: ha egy mondat a dia
*tartalmáról* szól, de egyetlen címszót sem használ, nem kapja meg a diát témaként. Ez
szándékos — a dia törzsszövegéből is bélyegeket csinálni visszahozná a „mindent megjelöl =
semmit se jelöl" hibát. A címkézés tájékozódási segédlet; az ellentmondást nem ez kapja el,
hanem az, hogy a copilot a session elején elolvassa a diák tényeit.

**Nem dönti el, kinek van igaza.** A deck referencia, nem orákulum: az ellentmondás annyit
jelent, hogy a beszélő és a dia mást mond — bármelyik tévedhet.

## Hogyan nyeri ki

- **Egy HTML-fájl egy dia.** Egy exportált deck fájlonként egy diát szállít; a fájlon belül
  címsorokra bontani olyan diákat találna ki, amik a deckben nincsenek. Markdown esetén
  fordítva: ott a címsorok a dia-határok.
- **A sorrend a deck sajátja** — a fájlnév eleji szám, aztán a konfigurált sorrend. A deckek
  azért vannak `01-`, `02-` módra nevezve, mert a sorrendjük jelent valamit.
- **A statikus export burkát lebontja.** Egyes exportáló eszközök egy betöltő héjat
  szállítanak, aminek a valódi dokumentuma JSON-stringként ül egy `<script>`-ben. Enélkül a
  dia a héj „Unpacking…" szövegére csomagolódna ki — tizenkét karakter, ami átmegy egy
  ürességvizsgálaton és tartalomnak olvasódik.
- **A `<title>` nem dia-szöveg.** Fejléc-metaadat; benne hagyva minden dia első „ténye" a
  saját sorszáma lenne.

## A számokról

A dia számait külön kiemeljük, mert az ellentmondás, amit el kell kapni, **szám**.

Ez **alakfelismerő, nem elemző**, és szándékosan túlgyűjt: egy fölösleges tény egy sor a
digestben, egy kimaradt tény viszont az a riasztás, amiért az egész létezik. Ez a
`wall/redaction.ts`-szel **ellentétes** irány, és ugyanabból az okból: ott egy tévedés
*publikál*, itt egy tévedés *hallgat*.

Két dolog azért fékezi:

- **Diagram-osztások kimaradnak.** Egy szám, aminek a közvetlen környezetében nincs betű, az
  tengelyfelirat vagy listajel — olyan szám, amit a dia *mutat*, nem amit *állít*.
- **Rangsor előzi meg a vágást.** Diánként legfeljebb 12 tény kerül a digestbe. A vágás kára
  nem az, hogy egy fölösleges szám bennmarad, hanem hogy a dia valódi állítását kiszorítja
  néhány osztás, ami véletlenül előrébb állt. Ezért a mértékegységet hordozó számok, majd a
  szavakkal körülvettek mennek előre.

A tizedesjel mindkét konvencióban olvasható: `21,8` és `21.8` ugyanaz a figura, és egy deck
meg egy beszélő nem feltétlenül ugyanazt használja.

## Ami nincs benne

PDF és PPTX. Valódi formátumok, érdemes lesz — bináris elemzést és egy függőségi döntést
kívánnak, a mért rés pedig nem várt rájuk. Konvertáld addig `.md`-be vagy `.html`-be.
