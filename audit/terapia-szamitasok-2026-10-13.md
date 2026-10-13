# Terápiás számítások – átvizsgálás (2026-10-13)

Csak olvasásos ellenőrzés volt: a kódban semmi nem változott. Több független vizsgáló nézte át a területeket, és minden
talált hibát két ellenőr próbált megcáfolni: az egyik a kód olvasásával, a másik számolt példával.

**Állapotok:** **megerősítve** = mindkét ellenőr szerint valós; **vitatott** = az egyik ellenőr szerint igen, a másik
szerint nem; **cáfolva** = egyik ellenőr szerint sem valós; **ellenőrizetlen** = ellenőrzés előtt megszakadt (a keret
miatt).

A teljes, nyers eredmény (bizonyítékok, számpéldák, ellenőri indoklások) a mellette lévő
`terapia-szamitasok-2026-10-13.json` fájlban van. A szkriptek és mesterséges adatok a munkagépen ideiglenes mappában
voltak, a repóban nincsenek.

## Röviden

- **A képletek és a mértékegységek rendben vannak.** Mesterséges adattal, ideális körülmények között a program
  visszaadja a valódi ISF-et, CH-arányt és hatásidőt.
- **A gond a feltételezésekben van:** mi számít „tiszta” eseménynek, mit von le a program, és mit tekint felszívódottnak.
  A valódi adataidhoz hasonló helyzetekben ezek torzítanak.
- **Gyanús a beállításod:** az ISF 1,0 és a CH-arány 1,8–2,5 g/E egymással nem konzisztens. A program minden becslése
  erre az ISF-re épül, ezért ezt érdemes először tisztázni a diabetológussal.

## A legfontosabb megerősített problémák

### 1. A „tiszta korrekció” nem elég tiszta (magas)
`server/utils/analysis.ts` ~313–349, `insulinKind.ts` 36–44 · isf F1, basics F1, empirikus E1, realdata RD1

- **Mit csinál most:** csak 60 percet néz vissza. Az 1–3 órával korábbi étkezési bólus maradéka (IOB) és a még
  felszívódó CH is az esésbe számít, de mindezt a korrekciós adagra írja.
- **A kezdő érték:** a kezdő meredekséget (gyorsan eső vércukor) nem szűri, a bázis-sodródást nem vonja le.
- **Számpélda:** 6 E étkezési bólusból 61 perc múlva még kb. 4,4 E hat, ami több lehet, mint maga a korrekció.
- **Szimulációs hatás:** sodródással ±27–29%, maradék CH-val –42% hiba az ISF-ben.
- **Ez magyarázhatja a látottakat:** az első óra ~0%-át és a 200%-ig érő sávot.

### 2. A mért hatásgörbe vége kevés eseményből áll (magas)
`analysis.ts` 327–333, 521–558, 569–581 · isf F2, basics F3, cache F7, empirikus E9

- **Mit csinál most:** időpontonként csak az épp meglévő eseményekből számol mediánt. 4 óra után 1–3 esemény marad
  (főleg az éjszakaiak), az illesztés mégis minden pontot egyformán súlyoz.
- **Szimuláció:** 6 esemény, mindegyik valódi hatásideje 4 óra. A program eredménye: 5 óra és „nem megbízható”.
- **Ez magyarázhatja a látottakat:** a „5 óra a beállított 4 helyett”, a 3,5 órás behorpadás és a 115–120%-os farok
  nagy eséllyel számtani műtermék, nem valódi hosszabb hatás.

### 3. A CH-arány becslése feltételezi, hogy a CH 4 óra alatt teljesen felszívódik (magas)
`analysis.ts` 228–240, 373–377, `AnalysisCard.vue` · ICR-1, empirikus E6, absorb F3

- **Számpélda:** 40 g, 16 E, valódi CH-arány 2,5 g/E. Ha a CH 5 óra alatt szívódik fel: 2,72; 6 óra alatt: 3,23
  (+29%); 8 óra alatt: 5,00. A program ilyenkor túl nagy CH-arányt (kevesebb inzulint) becsül.
- **Nincs megbízhatósági jelzés:** a CH-aránynak nincs „nem megbízható” jelzője, a „Becslések beírása” gomb mégis
  beírja. Egy oldalon belül ellentmond magának: a verdikt azt mondja, „nem eldönthető”, a cella mégis számot mutat.

### 4. A CH-arány és a tanult felszívódás a beállított ISF-ből számol (közepes–magas)
`analysis.ts` 263, 269, 373 · ICR-3, empirikus E2, E3, absorb F2, settings S8

- **Mit csinál most:** az ICR = CH / (hatott inzulin + végpont-eltérés ÷ ISF) képletben a beállított ISF szerepel. Ha
  az ISF rossz, és a kezdő vércukor nem a célon van, az ICR is rossz.
- **Szimuláció:** magas kezdő vércukornál 26–73% hiba.
- **A tanult felszívódás is:** ugyanezzel a beállított ISF-fel készül.
- **Az átvétel veszélye:** a „Becslések beírása” egyszerre írja be az új ISF-et és a régi ISF-ből számolt CH-arányt.

### 5. A beállításaid egymással nem konzisztensek (magas)
settings S1

| Beállítás | Ennek megfelelő napi összinzulin |
|---|---|
| ISF 1,0 (100-as szabály) | kb. 100 E |
| CH-arány 1,8 g/E (500-as szabály) | kb. 278 E |
| CH-arány 2,5 g/E (500-as szabály) | kb. 200 E |

- **Arány:** a kettő hányadosa (ISF / CH-arány) 0,40–0,56 mmol/L/g, a szokásos érték kb. 0,2. Ez 2–2,8-szoros eltérés.
- **Következtetés:** a nagy inzulinigényhez a CH-arány hihető, az ISF 1,0 viszont valószínűleg túl nagy. Kb. 0,35–0,5
  lenne konzisztens. Ezt a diabetológussal kell egyeztetni.
- **Az app nem jelzi:** semmilyen formában nem figyelmeztet erre. Ez az ISF hajtja az előrejelzést, a felszívódás
  tanulását és a CH-arány becslését is.
- **Az ISF 1,0 eredete:** nincs alapértelmezése a kódban. Kézi bevitel, és új napszak hozzáadásakor a program átmásolja
  az előző napszak értékeit (`terapia.vue:37`).

### 6. A bóluskalkulátor a célértéknél egy teljes IOB-nyit ugrik (magas)
`shared/utils/bolus.ts`, `BolusCalc.vue:186` · calc F1

- **Mit csinál most:** a cél alatt a teljes aktív inzulin levonódik (az étkezési adagból is), a cél felett csak a
  korrekcióig.
- **Számpélda:** CH-arány 1,8, ISF 1,0, cél 5,6, 40 g, IOB 8 E. Vércukor 5,59 → 14,0 E; vércukor 5,61 → 22,0 E.
  0,02 mmol/L különbség 8 E eltérést ad.
- **Félrevezető felirat:** magas vércukornál a „levonandó 8,0 E” felirat ellenére csak egy része vonódik le.

### 7. Az előrejelzés a mostani napszak ISF / CH-arányát használja minden étkezésre (magas)
`server/utils/predict.ts` ~106 · absorb F1

- **Mit csinál most:** napszakhatáron ugrik a hosszú távú érték és az inzulinjavaslat. Példa: 22:00-kor +4,7 mmol/L és
  +4,5 E.
- **Helyes módszer:** az étkezés (adag) idejének napszakát kellene használni, ahogy a Loop is teszi.

### 8. A tárolt elemzés nem frissül adatváltozásra és kódfrissítésre (magas)
`computed.ts`, `analysisCache.ts`, `jobs.ts`, `precompute.ts` · cache F1, F2, ICR-5, isf F6

- **Adatváltozás:** az altípus-átállítás, CH-jelölés, jegyzet, törlés, új adat és import nem érvényteleníti az
  elemzést. A javítás csak éjszaka vagy az Újraszámolás gombra látszik.
- **Kódfrissítés:** nincs verziója a tárolt eredménynek. Új image telepítése után a régi algoritmus eredménye maradhat,
  mert az indításkori előszámolás a meglévőt átugorja, és az éjszakai jelző aznapra már be van állítva.

### 9. Toujeo / bázis felismerése (közepes)
settings S2, S3, empirikus E4

- **A magyar címke:** a magyar „Bázis” altípus-címkét a beolvasás nem ismeri fel (`normalize.ts:119`). A „Basal” és a
  „Bólus” működik.
- **A bázisadag-egyezés:** csak az /api/ingest beérkezéskor fut. Kézi importnál és kézi „Automatikus” felvételnél nem,
  és utólag sem sorol újra.
- **A következmény:** egy fel nem ismert, 50 E körüli Toujeo-adag tönkreteszi az adott napszak becsléseit.

### 10. Egyéb megerősített problémák (közepes / alacsony)

**Számítás**
- **Egységnyi esés súlyozása:** a medián minden eseményt egyformán súlyoz, ezért a kis adagoknál a sodródás
  felnagyítódik (isf F5).
- **Korábbi étkezés:** az inzulin-maradékát beszámítja, a CH-maradékát nem (ICR-2).
- **Bázisellenőrzés:** a rögzített 4 órás kizárás a késői CH-hatást és az inzulin farkát sodródásnak mutatja (S6).
  Ítéletet már 1 óra adatból is ad (S7).
- **CH-javaslat:** csak az előrejelzési távon belüli mélypontot nézi, nagy aktív inzulinnál alulbecsül (absorb F8).
- **CareLink-időeltolás:** ha a legutóbbi szenzorérték 31–89 perccel régebbi, az egész 24 órás csomag 1 órával
  elcsúszhat, és másolatsorok maradnak (basics F5, ellenőrizetlen: timealign TA1).

**Napi inzulin és statisztika**
- **TDD-definíciók:** a napi inzulin háromféleképpen számolódik, a nézetek nem egyeznek (calc F2).
- **Napi átlag:** a mai, le nem zárt napot egész napnak osztja (calc F3).
- **„Szenzoradat 28%”:** valójában azt jelenti, hogy 30 napból 8 napra van adat, nem a szenzor minőségét (calc F4,
  basics F8).

**Megjelenítés és riport**
- **Nyomtatott riport:** a „nem megbízható” ISF/hatásidő becslést sima számként írja ki (cache F5).
- **Minőségcímke:** csak a darabszámon múlik, „megbízható” mellett is állhat „?” (cache F8, E8).

**Teljesítmény**
- **Lassú elemzés:** az `analyze()` négyzetes és szinkron. 60 napnál kb. 7 s, 90 napnál kb. 19 s (PC-n), a Pi-n több,
  és közben blokkolja a szervert (cache F6).

## Ami helyesnek bizonyult

- **Az inzulinmodell önkonzisztens:** a hatás integrálja 1, a hatás az IOB deriváltja, iob(DIA) = 0, és a szerver meg a
  kliens ugyanazt a modellt használja.
- **Mértékegységek:** egyik területen sincs hiba (g/E, mmol/L/E, perc/mp).
- **Ideális szimuláció:** a program visszaadja a valódi értékeket. ISF 1,00 (p10–p90: 0,99–1,01), hatásidő 240 perc
  (225–255), CH-arány 2,50.
- **A lapos első óra nem hiba:** a modell (75 perc csúcs, 4 óra) szerint 1 óránál még csak kb. 26%-nál tart a hatás, és
  a szenzor késése ezt tovább lapítja.
- **Rendben van még:**
  - az étkezés-csoportosítás,
  - a több CH-bejegyzés kezelése,
  - az éjfélen átnyúló napszak,
  - a minták közti interpoláció (±15 perc),
  - az előbólus kezelése.

## Cáfolt vagy vitatott gyanúk

Részletek a JSON-ban.

- **Cáfolva:**
  - a CH-arány átmenete (blend) hibás lenne (calc F5);
  - a 0,1-es kerekítés gondot okozna (calc F8);
  - a lefelé kerekítés rendszeres alulbecslés lenne (calc F9);
  - a gyors CH korrekciót étkezésivé minősítene (basics F9).
- **Vitatott:** a „nem megbízható” döntés zajérzékenysége (isf F3), a szelekciós torzítás (isf F4), az „Egész nap” sor
  „megbízható” címkéje (cache F9).

## Mi kell még (javasolt sorrend)

1. **Az ISF tisztázása** a diabetológussal. Az eddigi számok alapján kb. 0,35–0,5 lenne konzisztens, de ez csak
   becslés. Amíg az ISF bizonytalan, a CH-arány és a felszívódás becslése sem megbízható.
2. **Valódi adatos ellenőrzés:** a saját adatbázis-másolatodon megnézni a 6 tiszta korrekciót és a 2 tiszta étkezést,
   hogy tényleg étkezés után 1–3 órával voltak-e (realdata gap, ellenőrizetlen). Ehhez egy csak olvasó szkript kell a
   szerver `diabetes.sqlite` fájljának másolatán.
3. **Időbeli eltolás ellenőrzése:** CareLink órás eltolás, InPen/Health időzóna, CGM-késés (timealign gap,
   ellenőrizetlen).
4. **Javítások, ha jóváhagyod**, nagyjából ebben a sorrendben:
   1. tárolt eredmény: verzió és érvénytelenítés adatváltozásra;
   2. tiszta korrekció: legalább a beállított hatásidőnyi előzmény (vagy a maradék IOB/COB levonása), kezdő
      meredekség szűrése;
   3. a görbe illesztése csak ott, ahol elég esemény van (minimum-n, súlyozás);
   4. a CH-arányhoz megbízhatósági jelző, ha a görbe a végén még emelkedik; az átvétel ne írja be az igazolatlan ISF-re
      épülő CH-arányt;
   5. kalkulátor: folytonos IOB-levonás a célérték körül;
   6. előrejelzés: az étkezés napszakának ISF / CH-arányával számoljon;
   7. figyelmeztetés, ha az ISF és a CH-arány nem konzisztens;
   8. a magyar „Bázis” címke felismerése, és a bázisadag-felismerés minden bejövő úton;
   9. kisebbek: TDD-definíciók egységesítése, „Szenzoradat” felirat, riport „nem megbízható” jelzése.

## A kritikus kérdései

- Melyik szám tűnik rossznak: a hatásgörbe és a hatásidő, a CH-arány ítélet, a kalkulátor, az előrejelzés vagy a napi
  inzulin?
- Az ISF 1,0 orvosi vagy kipróbált érték, vagy csak benne maradt? Mennyi a napi összinzulin (Toujeo + NovoRapid)?
- A korrekciók jellemzően étkezés után 1–3 órával vagy egy korábbi korrekcióra „rákorrigálva” vannak?
- Megnyomtad-e az Újraszámolást az összes időszakon, és változtak-e utána a számok?

> Minden becslés tájékoztató. A terápia módosítása a diabetológus döntése.
