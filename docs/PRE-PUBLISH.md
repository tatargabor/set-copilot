# Pre-publish checklist

Publikálás előtti teendők a `set-copilot@0.1.0`-hoz. A *miért* és a nagyobb feature-tervek a [ROADMAP.md](ROADMAP.md)-ben.

## Jelenlegi állapot (2026-07-15)
- ✅ `npm install` + `tsc` build zöld
- ✅ `sox` telepítve macOS-en (14.4.2), Homebrew `/opt/homebrew/bin`
- ✅ mikrofon-lánc valódi jelet fog (`doctor`: peak=3516)
- ✅ tesztek: **73 zöld** (6 fájl)
- ✅ LICENSE megvan (MIT), tarball tiszta (nincs titok), `set-copilot` név szabad a registry-n
- ⬜ **`SONIOX_API_KEY` még nincs beírva** → valós STT teszt nélküle nem megy
- ⬜ **CI nincs** (`.github/workflows` hiányzik)
- ⬜ **Windows nem támogatott** (csak darwin/linux a kódban)

## 🎯 Heti cél (2026-07-15 hét): 0.1.0 kipörgetése
A launch legyen **lean** — a nagy roadmap-feature-ök (whisper, monitor-fal #6, MCP #7, hangvezérlés) **0.2/0.3**, nem erre a hétre valók. Ezen a héten:
1. **P0 blokkolók** letakarítása → **`npm publish` 0.1.0**.
2. `docs/` + `Brewfile` + README commit.
3. **Legfeljebb egy POC** spike a legnagyobb wow-hoz: lean **MCP stdio** (olvasás + `contribute`), auth és ngrok nélkül — csak hogy lássuk, működik-e a „másik AI kérdez/beküld" élmény.

## 🔴 P0 — publish előtt kötelező
- [ ] **Valós end-to-end mac-teszt** Soniox kulccsal: `/ds`→`/dd` diktálás, magyar nyelv, `--max-minutes`, csend-esemény. (Eddig csak mikrofon-szint igazolt.)
- [ ] **`doctor` crash javítása** — ha nincs `sox`, kezeletlen `ENOENT`-tel száll el a szép `✗` után; első futtató stacktrace-t lát. Clean exit kell.
- [ ] **A chatbe került npm token visszavonása** (npmjs → Revoke), publishkor `npm login`.
- [ ] **Név/verzió véglegesítés** — marad `set-copilot` + `0.1.0`?

## 🟠 P1 — erősen ajánlott publish előtt
- [ ] **Ingyenes lokál STT (whisper)** — `sttBackend` seam a `TranscriptEvent` mögött. (Részletek: ROADMAP #1.) *Nagy tétel — lehet, hogy 0.2-be csúszik.*
- [ ] **Interaktív `init`** — backend/mikrofon/nyelv/kulcs bekérése. (ROADMAP #2.)
- [ ] **Projekt-default `set-copilot.config.json` átgondolása** — értelmes alapok üres projektre; ERP-örökség tényleg kitisztult-e.
- [ ] **Install-mechanizmus letisztázása** — global vs project flow egy helyen; esetleg `set-copilot setup` parancs, ami a `brew install sox`-ot is felajánlja.
- [ ] **CI (GitHub Actions)** — `tsc` + `vitest` PR-en; opcionálisan publish-on-tag `NPM_TOKEN` secrettel.
- [ ] **`"os": ["darwin","linux"]`** a `package.json`-be — Windows usert install közben figyelmezteti.

## 🟡 P2 — mehet publish után is
- [ ] **Docs:** platform-mátrix, BlackHole aggregate-device guide, troubleshooting, lokál-STT szekció, Teams/Meet receptek (ROADMAP „Usage receptek").
- [ ] **`sox --help-device` mac-wart** — a source-listázás hibát ír macOS-en (nem töri a felvételt, csak csúnya).
- [ ] **Reconnect-logika valós teszt** — friss `956c1b6` (dropped socket → reconnect) hálózat-megszakítással.
- [ ] **CHANGELOG.md + release-folyamat** doksi; **CONTRIBUTING.md**.
- [ ] **Demo** (asciinema/GIF) a README-be.

## 🧪 Teszt-mátrix
- [ ] **Valós meeting két emberrel** + system audio (BlackHole) → a copilot hallja-e a másik felet és cross-referál-e a knowledge-re. („cowork" teszt.)
- [ ] Hosszú diktálás (>10 perc), csendkezelés, **magyar**.
- [ ] `rt` vs `chunk` mód összevetés (latency/pontosság).
- [ ] mic + system echo dedup (`poll.ts`) valós hívásban.

## Már kész / uncommitted munka
- ✅ user-szintű install (`init --global`): skillek + config + `0600` `.env`
- 🟡 `Brewfile` (új, még nincs commitolva) — `brew bundle` a repót klónozóknak
- 🟡 `README.md` — `brew bundle` megemlítve a macOS előfeltételnél (uncommitted)
