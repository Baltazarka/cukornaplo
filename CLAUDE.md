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

## Adatok és számolási döntések (a felhasználóval egyeztetve)
- **Forrás:** a vércukor csak a szenzorból jön (CareLink, 5 percenként). A bólust, a bázist (Toujeo) és a CH-t a felhasználó **kézzel** írja be (napló, bóluskalkulátor); az InPent már nem használja. Az InPen / Health forrású vércukor kézi mérésnek számít (`source='manual'`).
- **Becsült bázis nincs:** a napi összinzulin (TDD) mindenhol csak a naplózott adagokból, a **beadás időpontja** szerint számol (napi nézet, 14 napos tábla, időszak, riport egyezik). A be nem írt bázist nem pótoljuk.
- **Tájékoztató javaslatok:** a kalkulátor számolt adagját nem változtatjuk; minden kiegészítés (zsír-fehérje plusz, átfedés-figyelmeztetés) kis betűs tájékoztatás. Terápiás döntést nem írunk elő, „a diabetológussal egyeztesd”.
- **Zsíros étel (FPU, Pankowska / varsói módszer):** `shared/utils/fpu.ts`; a CH-bejegyzés `fat` / `protein` oszlopa; a javaslat a Terápia oldali `fpuPercent` %-a (alap 50). Az 1,5 órás emlékeztetőt a szerver állítja be (`entry-add`), és nem jön, ha az étkezés után 30 percnél később már volt inzulin. Gyors CH-hoz csak időzítési tanács, plusz inzulin nem.
- **Ikonok:** zsíros 🧀, gyors ⚡ (`CARB_TAG_ICON`, `shared/utils/carbTags.ts`); mit jelöljön zsírosnak: Számítások → „Zsíros ételek”.
- **Szenzor határa:** 40 mg/dL = 2,2, 400 mg/dL = 22,2 mmol/L; a határértéket `sgText()` írja ki („<2,2” / „>22,2”), a számolás a határértékkel megy.
- **CareLink (Guardian 4, carepartner API):** a `markers` csak `{type, index}`, mennyiség nélkül, ezért a Guardian appba beírt adat nem hozható át. A Guardian appnak nincs URL-sémája: a „Guardian megnyitása” gomb egy „Guardian” nevű iOS Parancsot futtat (`shortcuts://run-shortcut?name=Guardian`).
- **Elemzés:** csak szenzoradatból; a korábbi étel a mérete szerinti felszívódásig zavar; hipóból induló étkezés nem tiszta; bázis-sodródás ≥ 0,3 mmol/L/óra (3 óra adat, 3 nap) → a napszak becslése nem megbízható; az ISF adaggal súlyozott mediánból. Algoritmusváltozásnál növeld a `COMPUTE_VERSION`-t (`server/utils/computed.ts`).
- **Értesítések:** az inzulinjavaslat-push csak a céltartomány felső határa fölött szól (a kalkulátor a célértékhez korrigál; ez szándékos). Minden kiküldött push a `push_log` táblába kerül, a főoldalon visszanézhető.

## Kódolási tudnivalók
- `settings()` / `setting()` memóriában gyorsítótárazott közös objektumot ad vissza: **ne módosítsd**, mindig új objektumot építs (`{ ...régi, ...új }`), és `saveSettings()`-szel írj.
- Időzóna: minden faliidő → unix átváltás a `zonedToTs()`-en megy (DST-helyes); a `time.ts` `parts()` percenként gyorsítótáraz.
- Az elemzés (`analysis.ts`) ciklusaiban a bólusokat `bolusesBetween()`-nel szűkítsd időablakra; a `diaAt()` gyorsítótárazott. 90 napos elemzés PC-n ~0,3 s, ezt tartsd.
- A felhasználó széles főoldalt szeret: bal sáv (kalkulátor, terápia), közép, jobb sáv (Guardian-kártya, értesítésnapló); mobilon ezek a kalkulátor után jönnek.

## Ellenőrzés
- `pnpm build` a fordítás ellenőrzésére; kipróbáláshoz ideiglenes `node .output/server/index.mjs` más porton, utána állítsd le.
- Hosszú shell heredoc helyett írj segédszkriptet fájlba.
- Valódi adatos ellenőrzés: a Beállítások oldalon letöltött másolatból (a felhasználó a `data/` mappába teszi) `node scripts/use-export.mjs <fájl>` készít `data-real/` mappát (git- és Docker-mentes); a szerver ezzel `DATA_DIR=data-real CARELINK_INTERVAL=0` mellett futtatható. Az egészségügyi adatot ne másold ki a gépről, és ne kerüljön commitba.
