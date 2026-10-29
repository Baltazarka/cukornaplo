---
name: cukor-audit
description: A felhasználó vércukrának átnézése az utolsó néhány napra (alapból 2 nap, az előző héttel összevetve) több párhuzamos agenttel - étkezések, éjszakák/reggelek/bázis, korrekciók és ingadozás, push-értesítések. Használd, ha a felhasználó azt kéri, hogy nézd át / auditáld / elemezd a cukrát, a napjait, az éjszakáit.
---

# Vércukor-audit

## Szabályok (kötelező)
- **Terápiát nem írunk elő.** Ha valami beállítás felé mutat: „érdemes a diabetológussal egyeztetni”.
- Az adat a gépen marad: a kinyert fájlok csak a scratchpadbe kerülnek, az agentek nem írnak fájlt és nem küldenek semmit sehová. A végén töröld a kinyert fájlokat.
- Válasz magyarul, tömören.
- **Gyakori félreértés:** a terápia `icr` értéke **gramm CH / egység** (bólus = CH ÷ icr), nem egység / 10 g. Az agent-promptokba írd bele, és az eredményüket ellenőrizd ebből a szempontból.
- A kézi mérés (`source='manual'`) a statisztikába számít, a görbébe és a trendbe nem; a `KIZÁRT` szakasz (ráfekvés stb.) egyikbe sem.
- A régi napokon a 0 E bázis lehet naplózatlan is (az automatikus beírás 2026-10-26 óta van).
- Váltott műszak: `shift.anchor` hete `anchorShift`, onnan hetente váltakozik; délutános héten az `altSegments` érvényes (ha `altEnabled`).

## Lépések
1. Friss adat: a `data/` mappa legújabb `cukornaplo-ÉÉÉÉ-HH-NN.sqlite` fájlja. Ha régi (az utolsó mérés nem mai), kérd meg a felhasználót, hogy töltsön le újat (Beállítások → adatbázis letöltése).
2. Kinyerés: `node .claude/skills/cukor-audit/dump.mjs <export.sqlite> <scratchpad>/audit [napok=2] [összevetés=7]`
   → `adat.txt`, `stats.txt`. A kiírt statisztikából már egy összevető táblát is adhatsz a felhasználónak, amíg az agentek dolgoznak.
3. Három agent párhuzamosan (`general-purpose`, háttérben), mindegyik olvassa az `adat.txt`-t és a `stats.txt`-t:
   - **Étkezések:** CH, bólus, előtte VC, bólus–evés időzítés, csúcs és ideje, 2 és 4 óra múlva, hipó/magas; a bólus egyezik-e a képlettel (CH ÷ icr + (VC − cél) ÷ isf, a napszak és a műszakprofil szerint); hiányos bejegyzések (CH bólus nélkül, típus nélküli adag, aránytalan adag).
   - **Éjszakák és reggelek (22–09), bázis:** mélypont és ideje, esés üteme (mmol/L/óra) étel és ható bólus nélküli szakaszokon; késő esti korrekciók hatása; hajnali jelenség vagy hajnali esés; a hipó-pushok indokoltsága és gyakorisága.
   - **Korrekciók és ingadozás:** összevetés az előző időszakkal és a javulás/romlás valószínű oka; korrekciók tényleges mmol/L/E hatása a beállított isf-hez képest; halmozódás (3 órán belüli adagok); legnagyobb emelkedések/esések, szenzorzaj, CV.
   Mindegyik promptba: a fenti szabályok, „max ~400 szó, magyarul, táblázattal ahol segít”.
4. Összefoglaló a felhasználónak: számok (előtte/most tábla), ami jól működik, amire figyelni kell (sorszámozva), és a programot érintő észrevételek (pl. túl sok push, téves előrejelzés, profilválasztás) – ez utóbbiakat csak javasold, kérdezz rá, mielőtt kódhoz nyúlsz. Ha egy agent tévedett (pl. icr-félreértés), mondd meg.
5. Takarítás: `rm -rf <scratchpad>/audit`.
