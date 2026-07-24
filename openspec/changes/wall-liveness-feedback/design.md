## Context

Ez a change három projekt (consumer-c, consumer-a, consumer-e/set-copilot) élő session-átirataiból nőtt ki. A
legerősebb, projekteken átívelő jel a **liveness-szorongás**: „hallod, amit mondok?", „hahó", „működik a
capture ismét?" — a felhasználó szóban ellenőrzi, hogy a rendszer él, mert a fal nem mondja meg. A második
a **latency láthatatlansága**: egy rajz ~20 mp, közben néma „dolgozom"-ablak, amit a user nem tud
megkülönböztetni egy halott faltól („miért tart ilyen soká?").

Két, egymást kiegészítő, de mechanizmusban külön képesség kell. Mindkettő szigorúan **additív** és
config-semleges: nem azt szabja meg, *mit* mond a copilot (azt a `live-narration-box` és az engagement-
policy), hanem hogy a fal láthatóvá teszi az **élet-** és **aktivitás-állapotot**.

## Decisions

### D1: A liveness-jel a szerverből jön, a copilottól függetlenül

A load-bearing invariáns: az a komponens, aminek az élete kérdéses (a copilot), nem lehet a liveness-jel
forrása. A wall szerver már ismeri a runtime dirt (a `wall-events.jsonl`-t onnan tailelia); megkapja a
`runtimeDir`-t explicit opcióként, és onnan olvassa:
- **capture él-e** → `capture.pid` + `process.kill(pid, 0)` (ugyanaz a próba, amit a `stop`/`status`
  használ);
- **mikor hallott utoljára** → a `transcript.jsonl` (meeting módban) mtime-ja, vagy az utolsó sor `ts`-e.

Egy `heartbeat` wire-üzenet megy timeren (pl. 1000 ms) minden kliensnek: `{ kind: "heartbeat",
captureAlive, lastHeardMsAgo }`. Szerver-autoritatív, mint a `show`: a `normalizeEvent`/ingest eldobja, ha
egy forrás megpróbál `heartbeat`-et injektálni (a `wall-events.jsonl` a dokumentált termelő-varrat).

**Miért nem a copilot emitál életjelet?** Mert akkor egy megakadt copilot mellett a fal halottnak látszana —
pont abban a helyzetben, amikor a legfontosabb tudni, hogy a *capture* még megy.

### D2: Állandó státuszsáv, nem doboz

A státusz nem `box` a layoutban (különben egy tele layout kiszorítaná — lásd a `wall-layout-and-box-policy`
tanulságát), hanem egy vékony, mindig renderelt sáv a `#wall` fölött/alatt. Három állapot, ránézésre
megkülönböztethető:
- 🎙 **figyelek** — capture él, friss audio (`lastHeardMsAgo` < küszöb);
- 💤 **csend N mp** — capture él, nincs friss audio;
- ⚠ **capture leállt** — `captureAlive === false`.

A „N mp/perc" emberi formázása kliens-oldali; a szerver csak nyers `lastHeardMsAgo`-t küld.

### D3: A pending egy könnyű jelölés, nem tartalom

A rajzoló fork 16–62 mp. Amikor a copilot ilyet indít, előbb egy `pending` jelölést emitál a cél-
kategóriára: `{ kind: "pending", category, zone, label, ttlMs }`. A doboz azonnal placeholdert mutat (⏳ +
`label`). A **valódi tartalom bármely payloadja** a dobozba lecseréli (a meglévő pane-modell: a pending egy
külön pane, amit az első valós render elrejt). A `ttlMs` (default pl. 20000) lejáratkor magától elengedi —
egy megakadt fork ne hagyjon örök spinnert.

**Miért külön wire-kind és nem egy `text` esemény?** Mert a placeholder viselkedése más: nem halmozódik
(scroll), nem marad meg (latest), hanem *átmeneti* és *lejár*; és a valódi render-típus (graph/chart/image)
váltja, nem egy újabb szöveg. Egy dedikált `pending` a legkisebb, legtisztább mechanizmus.

### D4: A pending zónázott, és privát az alapértelmezése

A pending is `zone`-t hordoz, és ugyanaz a zóna-kapu routeolja, mint minden eseményt (`private` pending nem
jut publikus kliensre). A copilot alap-mandátuma privát pending (operátor-visszajelzés); a publikus falra
csak akkor kerül „készül…", ha explicit `both`/`public`. Így egy közönség előtti fal nem telik meg belső
címkés spinnerekkel.

### D5: Interakció a director/pacing-gel

A pending azonnali (`priority: "immediate"` szemantika): bypasseli a paced dwellt, hogy a placeholder rögtön
látszódjon. A rá következő valódi rajz a szokásos úton jön; a pending-pane elrejtése a valós render
`show(entry, …)` lépésében történik. A `wall-predictive-staging` promote-jával kompatibilis: egy előre-
staged privát vizuál promotehoz nem kell pending (már kész) — a pending a *reaktív*, még nem kész rajzé.

## Risks / trade-offs

- **Heartbeat-zaj**: 1000 ms-es broadcast N kliensre olcsó (pár bájt), de a status-strip ne animáljon
  agresszíven — a „N mp" másodpercenként frissül, semmi több.
- **`lastHeard` meeting vs dictation**: dictation módban nincs élő fal; a heartbeat elsődlegesen meeting
  módra való. A `transcriptOutput` mtime-ját olvassuk, nem a dictationét.
- **Pending-hazugság**: ha a fork elhal, a `ttlMs` old — de a copilotnak (SKILL.md) is illik hibát
  jeleznie chatben. A ttl a végső védőháló, nem az elsődleges jelzés.
- **Zóna-tévedés**: egy `both` pending „készül…" felirata publikus — ezért az alap privát; a mandátum a
  SKILL.md-ben explicit.
