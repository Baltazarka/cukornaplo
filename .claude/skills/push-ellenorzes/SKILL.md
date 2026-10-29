---
name: push-ellenorzes
description: A Cukornapló kiküldött push-értesítéseinek (hipó-veszély, alacsony, szénhidrát- és inzulinjavaslat) utólagos ellenőrzése a valódi vércukorral - téves riasztás, fölösleges ismétlés, CH után jött push, késői riasztás. Használd, ha a felhasználó szerint túl sok / rossz / késő a push, vagy egy értesítési szabály módosítása előtt és élesítése után.
---

# Push-értesítések ellenőrzése

## Háttér
- Logika: `server/utils/notify.ts` (`checkAlerts`, percenként a `server/plugins/notifier.ts`-ből), előrejelzés: `server/utils/predict.ts` (`risk`, `treated` = az utolsó `RECENT_TREAT_SEC` alatt ≥ 10 g CH).
- Beállítások: settings `notify` (`repeatMin`, `hypoHorizon`, `insulinMin`…), céltartomány `range_low` / `range_high`.
- Minden kiküldött push a `push_log` táblában van; a letöltött másolatban is.
- Az inzulinjavaslat szándékosan csak a céltartomány felső határa fölött szól.

## Szabályok
- Egészségügyi adat: a kimenetet ne másold ki a gépről, ne commitold; a válaszba csak összesítést és pár példát írj.
- Terápiát nem írunk elő. Kódot csak akkor módosíts, ha a felhasználó kéri; előtte mutasd meg, mit változtatnál.

## Lépések
1. A `data/` legújabb `cukornaplo-*.sqlite` letöltése (ha régi, kérj újat a felhasználótól).
2. `node .claude/skills/push-ellenorzes/check.mjs <export.sqlite> [napok=7]`
3. Értékelés a jelzések alapján:
   - **TÉVES**: hipó-veszély, de nem ment a céltartomány alá → az előrejelzés túl borúlátó (a `jósolt / valós min` párok mutatják, mennyivel).
   - **ISMÉTLÉS**: ugyanarra az epizódra, romlás nélkül → az ismétlési szabály túl sűrű.
   - **CH UTÁN**: beírt CH után is szólt → a `treated` ablak rövid, vagy a CH-t később írta be.
   - **KÉSŐN**: az első push már céltartomány alatt jött → az előrejelzés későn kapcsol.
4. Ha szabályt módosítottál: a változás csak az élesítés (Docker) utáni pushokra hat. Pár nap múlva új letöltéssel futtasd újra, és vesd össze a jelzések számát.
5. Rövid összefoglaló magyarul: hány push, melyik jelzésből mennyi, 2–3 jellemző példa, javaslat (csak ha kérik, akkor kód).
