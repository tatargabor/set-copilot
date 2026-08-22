# set-copilot — tervezési dokumentáció

Belső tervezési és döntési jegyzetek a publikálás előtti munkához. (A felhasználói dokumentáció a repo gyökér [`README.md`](../README.md)-ben van.)

- **[ROADMAP.md](ROADMAP.md)** — vízió, feature-backlog (lokál STT, interaktív init, hangvezérlés, output-modalitások), architektúra-alapkövek, döntések logja, nyitott kérdések.
- **[PRE-PUBLISH.md](PRE-PUBLISH.md)** — publikálás előtti checklist P0/P1/P2 szerint, task listával és teszt-mátrixszal.
- **[CONVENTIONS.md](CONVENTIONS.md)** — munkakonvenciók (git: egy `master` ág, commit fejlesztésenként; jegyzetek md-be).
- **[wall-public-parity.md](wall-public-parity.md)** — a nyilvános fal: közönség (`audience`) és zóna két külön tengely, a fail-closed alapértelmezés, és két kész config-alak arra, hogy a fal többet mutasson.

### Nyitott hibák — mért bizonyítékkal, elfogadási listával

- **[capture-goes-deaf-no-transcript-guard.md](capture-goes-deaf-no-transcript-guard.md)** —
  **P0.** A capture megsüketülhet úgy, hogy semmi nem szól: az audio folyik, a socket
  „connected", és nulla transzkript-esemény érkezik. Mérve 2026-08-22: 16,8 MB audio →
  **0 bájtos leirat, exit 0**, tíz perc beszéd elveszett. A `soniox-rt.ts` két védelme
  (reconnect, ping/pong) a CSATORNÁT figyeli; az EREDMÉNYT (jön-e egyáltalán szöveg) semmi.
  Van őr a néma mikrofonra, a néma transzkriptre nincs.
- **[handoff-transcript-stitch.md](handoff-transcript-stitch.md)** ·
  **[handoff-stop-stitches-only-last-rotation.md](handoff-stop-stitches-only-last-rotation.md)** —
  korábbi, teljes bizonyítékkal dokumentált tételek.
- **[wall-field-backlog.md](wall-field-backlog.md)** — a fal és a meeting-copilot mezei
  backlogja, valós használatból rangsorolva.

> Ezek élő dokumentumok — ahogy döntünk vagy elkészül egy tétel, itt frissítjük.
