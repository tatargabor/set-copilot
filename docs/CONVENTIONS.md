# Munkakonvenciók

Ahogy ezen a projekten dolgozunk (a felhasználó kérése alapján, 2026-07-15):

## Git

- **Egy ág: `master`.** Nincsenek külön feature/fix branchek — minden közvetlenül a default branchre megy.
- **Commit fejlesztésenként, folyamatosan.** Minden logikailag zárt egység (egy feature, egy fix, egy doc-blokk) külön commit, ahogy elkészül — nem egyben a végén, és nem külön ágon.
- A push külön kérésre történik, nem automatikusan.

## Jegyzetek / memória

- **A tervek és döntések `.md` fájlokba** kerülnek a `docs/` alá (verziózható, a repóval utazik) — **nem** a Claude beépített (wt-)memória-rendszerébe.
- Élő dokumentumok: ahogy döntünk vagy elkészül egy tétel, itt frissítjük.
