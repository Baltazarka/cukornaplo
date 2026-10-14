# Cukornapló – útmutató Claude-nak

Személyes cukorbetegség-napló. Nuxt 4 (SPA, `ssr: false`) + Nitro szerver, SQLite (`node:sqlite`), CareLink-lekérdező, kézi inzulin- és CH-könyvelés (régebben InPen/Health feltöltés), Docker-telepítés. A felület és a kommentek magyarul vannak.

## Munkamenet
- A felhasználó magyarul ír; válaszolj magyarul, tömören.
- **Mindig commitolj és pusholj `main`-re**, kérdezés nélkül, ha egy kész változtatás elkészült.
- Commit üzenet magyarul, a végén a Claude Code által megadott `Co-Authored-By` sorral (az aktuális modell nevével).
- Két gépen (otthon / munkahely) dolgozik, git-en át szinkronban: munka előtt `git pull`.

## Technikai szabályok
- **Nuxt 4.5.2-n marad** (a 4.6.0 Windowson minden oldalon 500-as SSR-hibát ad).
- Csomagkezelő: **pnpm** (`minimumReleaseAge`, build-szkripteket az `allowBuilds` engedélyezi a `pnpm-workspace.yaml`-ban).
- Grafikon: ECharts 6, a napi grafikon `app/components/GlucoseDayChart.vue`.
- Értesítés a felületen: `useToast()` / `useToastFrom()` (nincs böngészős `alert()`); kérdés: `askConfirm()` (nincs `confirm()`).
- Mobil elrendezés: `main.css`-ben a ≤700 px szabályok (`display: contents` + `order`).
- A kézi vércukor (`entries.source='manual'`) a statisztikába beleszámít, de a szenzorlefedettségbe, trendbe és a görbébe nem.
- Az `data/` mappa (jelszó-hash, API-kulcs, CareLink-kulcs, adatbázis) **soha nem kerülhet git-be**.

## Ellenőrzés
- `pnpm build` a fordítás ellenőrzésére; kipróbáláshoz ideiglenes `node .output/server/index.mjs` más porton, utána állítsd le.
- Hosszú shell heredoc helyett írj segédszkriptet fájlba.
- Valódi adatos ellenőrzés: a Beállítások oldalon letöltött másolatból `node scripts/use-export.mjs <fájl>` készít `data-real/` mappát (git- és Docker-mentes); a szerver ezzel `DATA_DIR=data-real CARELINK_INTERVAL=0` mellett futtatható. Az egészségügyi adatot ne másold ki a gépről, és ne kerüljön commitba.
