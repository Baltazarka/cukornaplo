---
name: valodi-adat-teszt
description: A Cukornapló kipróbálása valódi adatmásolaton - ideiglenes szerver más porton, véletlen jelszó, az összes fontos végpont végigkérése (500-as hibák, lassú válaszok), majd takarítás. Használd szerveroldali változtatás után commit előtt, vagy ha a felhasználó hibát jelez ("eltűnik", "500", "nem tölt be").
---

# Füstpróba valódi adatmásolaton

Cél: commit előtt kiderüljön, ha egy végpont 500-at ad vagy lelassul (így csúszott át egyszer az `/api/day` 500-as hibája).

## Szabályok
- Egészségügyi adat nem hagyhatja el a gépet, nem kerülhet git-be, és nem írjuk ki a válaszba (a szkript csak státuszt és méretet ír).
- Az ideiglenes adatmappa a **scratchpadben** legyen, a végén töröld.
- A tesztjelszót ne írd ki a felhasználónak.
- Shell heredoc helyett a kész szkripteket használd.

## Lépések
1. `pnpm build` (ha nem friss a `.output`).
2. Adatmappa: `node .claude/skills/valodi-adat-teszt/prepare.mjs <scratchpad>/dt`
   (alapból a `data/` legújabb `cukornaplo-*.sqlite` letöltése; ha nincs, kérd meg a felhasználót, hogy töltsön le egyet a Beállítások oldalon).
3. Szerver háttérben: `DATA_DIR=<scratchpad>/dt PORT=3994 CARELINK_INTERVAL=0 node .output/server/index.mjs`
   Várj, amíg a `curl -s -o /dev/null http://127.0.0.1:3994/` sikerül.
4. Próba: `node .claude/skills/valodi-adat-teszt/smoke.mjs 3994 [ÉÉÉÉ-HH-NN]`
   - `HIBA` sor → nézd meg a szervernaplót, javítsd, építsd újra, ismételd.
   - 1 s fölötti válasz gyanús (a 90 napos elemzés célja ~0,3 s PC-n).
5. Ha felületi változás is volt: a böngészőpanelen `http://127.0.0.1:3994` (a jelszó a smoke-futásé; új jelszóhoz futtasd újra a 2. lépést).
6. Takarítás:
   - a szerver leállítása (PowerShell: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? CommandLine -like '*index.mjs*' | % { Stop-Process -Id $_.ProcessId -Force }`);
   - `rm -rf <scratchpad>/dt`.
7. Jelentés a felhasználónak: hány végpont OK, mi volt hibás, mit javítottál.
