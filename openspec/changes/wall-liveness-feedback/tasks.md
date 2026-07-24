## 1. Wire-üzenetek és típusok

- [x] 1.1 `src/wall/types.ts`: `Heartbeat` üzenet (`kind: "heartbeat"`, `captureAlive: boolean`,
      `lastHeardMsAgo: number | null`) és `Pending` üzenet (`kind: "pending"`, `category`, `zone`,
      `label: string`, `ttlMs?: number`) hozzáadása a `WireMessage` unióhoz
- [x] 1.2 Type guardok: `isHeartbeat`, `isPending` — a `isShowCommand` mintájára
- [x] 1.3 A `RenderType`/payload-vokabulár **nem** bővül: a pending nem render-típus, hanem átmeneti
      jelölés (D3) — külön kell tartani a `PAYLOAD_KEYS`-től

## 2. Szerver-oldali életjel (D1)

- [x] 2.1 `src/wall/server.ts`: `WallServerOptions` kap egy `runtimeDir`-t; `src/wall/index.ts` átadja
      `cfg.runtimeDir`-t
- [x] 2.2 Heartbeat-timer (pl. 1000 ms): `capture.pid` olvasása + `process.kill(pid,0)` a `captureAlive`-hoz;
      `transcriptOutput` mtime/utolsó `ts` a `lastHeardMsAgo`-hoz
- [x] 2.3 A heartbeat broadcastja minden kliensre (zóna-független, mint a `show`) — a `broadcast` ág kezelje
- [x] 2.4 Ingest-védelem: `normalizeEvent`/`ingest` dobja el a kívülről injektált `heartbeat`-et, warninggal
      (a `show`-nál meglévő minta)
- [x] 2.5 Új kliens `replay`-nél is menjen egy azonnali heartbeat, hogy a státusz ne legyen üres a csatlakozás
      és az első tick között

## 3. Pending az ingesten (D3, D4)

- [x] 3.1 `src/wall/emit.ts`: a `pending` üzenet normalizálása/validálása (kötelező `category` + `label`,
      opcionális `zone` default `private`, `ttlMs` default pl. 20000); egy payloadot **nem** vár
- [x] 3.2 `ingest`: a `pending` a zóna-kapun át broadcastol (mint egy esemény), de nem akkumulálódik a
      `latest`/graph állapotba (nem replayelendő állapot)
- [x] 3.3 `src/cli.ts`: `wall-emit` engedje át a `pending` alakot (vagy külön `wall-pending` parancs, ha
      tisztább) — a producer/skill innen jelöl

## 4. Kliens: állandó státuszsáv (D2)

- [x] 4.1 `src/wall/public/index.html` + `wall.css`: vékony, mindig látható státuszsáv a `#wall` mellett
      (nem grid-cella)
- [x] 4.2 `src/wall/public/wall.js`: `heartbeat` kezelése — a három állapot renderelése (🎙 figyelek /
      💤 csend N mp / ⚠ capture leállt), a „N mp/perc" emberi formázása kliens-oldalon
- [x] 4.3 Küszöb a „figyelek" vs „csend" váltáshoz (pl. 4000 ms) — kliens-konstans, nem szerver-döntés

## 5. Kliens: pending-placeholder (D3, D5)

- [x] 5.1 `src/wall/public/wall.js`: `pending` kezelése — a cél-doboz(ok)ban egy pending-pane (⏳ + `label`),
      `priority:"immediate"` szemantikával (bypasseli a paced dwellt)
- [x] 5.2 A valódi tartalom első renderje elrejti a pending-pane-t (a meglévő pane-hide mechanizmus)
- [x] 5.3 `ttlMs` lejáratkor a kliens elengedi a placeholdert (setTimeout), és egy frissebb pending újraindítja
- [x] 5.4 `wall.css`: pending-pane stílus (spinner/badge), a `slot-paced`-be is illően

## 6. Skill-mechanika (D3, D4)

- [x] 6.1 `skills/meeting-copilot/SKILL.md` Phase 5: rajzoló fork indításakor előbb egy `pending` emit a
      cél-kategóriára (`zone:"private"` default), egy soros `label`-lel — a fork utána a valós rajzot emitálja
- [x] 6.2 A SKILL.md rögzítse: a `pending` operátor-visszajelzés; publikus „készül…" csak explicit szándékkal
      (`zone` felülírás)

## 7. Tesztek (pure logika)

- [x] 7.1 `isHeartbeat`/`isPending` type guardok és a `pending` normalizálás (default zone/ttl, hiányzó
      `label` elutasítása) — `emit.test.ts` mintájára
- [x] 7.2 Az injektált `heartbeat` eldobása az ingesten
- [x] 7.3 A pending nem kerül a replay-állapotba (nem `latest`, nem graph)

## 8. Kézi verifikáció

- [x] 8.1 `set-copilot wall` + capture: a státuszsáv „figyelek"→„csend"→„capture leállt" átmenetei valósak
- [x] 8.2 Egy `pending` emit után látszik a placeholder; a rá következő valós rajz lecseréli; ttl-lejárat old
- [x] 8.3 `zone:"private"` pending nem jelenik meg a `/wall` publikus nézetben
