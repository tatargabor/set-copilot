## Why

Három projekt élő session-átirataiban a leggyakoribb visszatérő jel a **liveness-szorongás**: „hallod, amit mondok?", „hahó", „működik a capture ismét?", „itt vagyok, figyelsz?" — a felhasználó *szóban* kényszerül ellenőrizni, hogy a copilot él-e és hall-e, mert a falon semmi nem jelzi. Ehhez társul a **latency láthatatlansága**: „miért tart ez ilyen sokáig?", „mindig dolgozik", egy rajz ~20 mp — egy néma „dolgozom"-ablak vizuálisan megkülönböztethetetlen egy halott faltól. A `wall-predictive-staging` a *valós* latenciát csökkenti; ez a change a **maradékot teszi láthatóvá**, és megszünteti a „él-e egyáltalán?" bizonytalanságot.

## What Changes

- **Szerver-oldali életjel.** A wall szerver a runtime dirből (capture PID + a `transcript.jsonl` frissessége) periodikusan `heartbeat` üzenetet broadcastol minden kliensnek: `captureAlive`, `lastHeardMsAgo`. Kulcsdöntés: a liveness-jel **nem függhet a copilottól** — egy néma vagy megakadt copilot mellett is látszania kell, hogy a capture él és mikor hallott utoljára.
- **Állandó státuszsáv a falon.** A kliens egy vékony, mindig látható sávban jeleníti meg az állapotot (nem doboz, tehát bármely layoutban túléli): 🎙 „figyelek", 💤 „csend N mp-e", ⚠ „a capture leállt".
- **Dobozonkénti „dolgozom/rajzolom" jelzés.** Amikor a copilot rajzoló forkot indít, egy könnyű `pending` jelölést emitál a cél-kategóriára; a doboz egy placeholdert mutat (⏳ + egysoros címke, pl. „rajzolom: adatfolyam"), amit a valódi tartalom megérkezése lecserél. Lejárat véd a beragadt placeholder ellen, ha a rajz elhal.
- Config-only marad: mit narrál a copilot, azt nem ez a change dönti — csak azt, hogy a fal láthatóvá teszi az *élet-* és *aktivitás*-állapotot.

## Capabilities

### New Capabilities

- `wall-liveness`: A wall szerver a runtime dirből származó, copilottól független életjelet (capture él-e, mikor hallott utoljára) broadcastolja, a kliens pedig egy állandó státuszsávban jeleníti meg.
- `wall-pending-indicator`: Egy folyamatban lévő (fork-alapú) rajz a cél-dobozban azonnal látható „dolgozom" placeholdert kap, amit a kész tartalom lecserél, lejárattal a beragadás ellen.

### Modified Capabilities

<!-- Nincs: a `wall-feed` meglévő követelményei nem változnak; ez additív. -->

## Impact

- `src/wall/server.ts` — heartbeat-timer + broadcast; a szerver megkapja a `runtimeDir`-t (ma csak `projectRoot`-ot lát), és onnan olvassa a capture PID-et + `transcript.jsonl` mtime-ot.
- `src/wall/types.ts` — új wire-üzenetek: `Heartbeat`, `Pending` (a `WireMessage` unió + type guardok).
- `src/wall/public/{wall.js,wall.css,index.html}` — állandó státuszsáv + pending-placeholder renderelő.
- `src/wall/emit.ts` / `src/cli.ts` — `pending` emit-út (a producer/skill jelöli a rajzot); a `heartbeat` szerver-only, mint a `show`.
- `skills/meeting-copilot/SKILL.md` — Phase 5: rajzoló fork indításakor előbb egy `pending` jelölés a cél-kategóriára.
- Nincs érintés az audio/capture úton; a mic/system primitívre épít, nem új capture-re.
