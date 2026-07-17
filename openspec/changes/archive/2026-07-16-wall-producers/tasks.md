> **Reconciliation (D9).** A change eredetileg egy **autonóm Haiku gráf-worker** köré épült
> (D1/D3/D4/D5/D7). A megvalósítás közben megszületett a döntés: **a fő agent egy Opus 4.8 session**
> (mint a mai kézi copilot-sessionök), és **ez érti meg + emittálja** a strukturált spec-eket; a
> Haiku-worker **opcionális offloaddá** vált (a `wall-feed` prototípus már bizonyította). Az alábbi
> task-lista ezt tükrözi: a fő út a **fő session → `wall-emit` seam → determinisztikus render**; a
> Haiku-worker task-jai megmaradnak, de `(offload)` jelöléssel.

## 1. Producer seam & event-source binding

- [x] 1.1 A „producer" a fő Opus session; a keze a `set-copilot wall-emit` CLI (`src/wall/emit.ts`), ami egy byte-kompatibilis `DisplayEvent`-et fűz a `monitor-wall-display` event-source varratára (`<runtimeDir>/wall-events.jsonl`, task 3.4)
- [x] 1.2 `wall-emit` validál: `category` kötelező, `zone` default `both`; ismeretlen/hibás esemény warninggal eldobva, sosem töri a capture-t/szervert (a `detect.*` „bad regex ejtve" mintája)
- [x] 1.3 Byte-kompatibilitás a fake-feed / `wall-feed` esemény-formájával (`monitor-wall-display` D6) — ugyanaz a `WireMessage`, a display magja, SSE, director, kliens-render érintetlen

## 2. Text path (no model hop) — a fő session emittál

- [x] 2.1 A fő session a `wall-emit`-en tol `súgás`/`riasztás` (és bármely `text`-render) kategóriát — nincs köztes LLM (D2)
- [x] 2.2 A `speaker` (`mic`/`system`) és `zone` primitívek megőrizve az emittált eseményen
- [x] 2.3 `priority:"immediate"` a riasztás/scroll-log eseményeken → a director pacingjét megkerüli
- [x] 2.4 Unit teszt: `wall-emit` validáció (jó/rossz esemény), zóna-default, immediate-flag megőrzés

## 3. Graph/chart spec — a fő session emittál (Haiku = opcionális offload)

- [x] 3.1 A fő session `architektúra` graph-deltát és `metrika` chart-spec-et emittál a `wall-emit`-en (tömör JSON, nem rajz — D9)
- [x] 3.2 `visual` id-vel csoportosít; `graph.op:"reset"` = téma-határ; a kliens inkrementálisan rajzol (a display adja)
- [x] 3.3 (offload) A perzisztens Haiku gráf-worker (`producers/graph-worker.ts`) megmarad opcionális offloadként — stateful delta, single structured call, prompt-cache, direct-hub push (D3/D4). Prototípusként bizonyítva a `wall-feed`-del.
- [x] 3.4 (offload) Delta-diff: csak új node/edge a felhalmozott state ellen — a `graph-worker` már ezt teszi
- [ ] 3.5 (offload) Prompt-cache stabil prefix (system + felhalmozott gráf) — a worker már cache_control-t tesz a systemre; a felhalmozott-gráf-prefix cache-elése későbbi kar
- [x] 3.6 Push egyenesen a hubra (a `wall-emit` / worker a JSONL-varratra ír, nem a fő sessionön vissza)

## 4. Grounding — a fő session MAGA a forrás (D5 tárgytalan a fő úton)

- [x] 4.1 A fő session groundingja a knowledge-base + beszélgetés-történet — nincs külön kontextus-tipp hop a fő úton (D9)
- [ ] 4.2 (offload) Ha a Haiku-workert használjuk skálázáskor, a D5 kontextus-tipp újraéled — descoped az MVP-ből, `context-hints.ts` nem épül most
- [x] 4.3 A `graph-worker` autonóm alap tipp nélkül is termel — a `wall-feed` prototípus ezt mutatta

## 5. End-to-end — a fő session hajtja a falat

- [x] 5.1 A fő session `wall-emit`-tel renderel a falra; a hozzáadott latency a render-hop (JSONL-tail + SSE ~ ms)
- [x] 5.2 (offload) A Haiku-worker út a `wall-feed`-del bizonyítva (valódi transcript → gráf+chart, 1–4 mp/delta)
- [x] 5.3 Élő demonstráció: a fő Opus session valós spec-eket emittál a futó falra, a render igazolva
- [x] 5.4 Rollback: `wall-emit` nélkül a fake-feed / `wall-feed` ugyanazon a varraton visszaáll, a display érintetlen

## 6. Skill & docs

- [x] 6.1 `meeting-copilot/SKILL.md`: a fő session tanítása, hogy a poll-batch feldolgozásakor `wall-emit`-tel tegye a falra a súgás/riasztás/graph/chart spec-eket (a *mechanika* a skillé; a *taxonómia* a `copilot.alerts` / kategória-config marad)
- [x] 6.2 `docs/ROADMAP.md` #6: a valós-feed iteráció + a D9 pivot (Opus = extractor/emitter, Haiku = offload) rögzítése
- [x] 6.3 Feloldott open questions + consent/privacy jegyzet (transcript-tartalom a modellhez az offload úton)
