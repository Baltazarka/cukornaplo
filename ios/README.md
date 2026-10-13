# Cukor riasztó (natív iOS app)

Kis SwiftUI app, ami a háttérben percenként lekérdezi a Cukornapló `/api/alarm` végpontját, és hipó-veszélynél
**hangot játszik** (ez a némító kapcsolón is átszól, mert hanglejátszás, nem értesítés).

## Fordítás (Mac nélkül)
1. GitHub → **Actions** → „iOS riasztó app” → **Run workflow** (vagy push az `ios/` mappába).
2. A futás végén az **Artifacts** között töltsd le a `CukornaploAlarm-ipa` fájlt, csomagold ki: `CukornaploAlarm.ipa`.

## Telepítés (7 naponta)
- **AltStore** vagy **Sideloadly** (Windowson is): húzd rá az `.ipa`-t, add meg az Apple-azonosítódat. Az ingyenes
  aláírás 7 napig érvényes, utána újra kell telepíteni (az AltStore ezt automatikusan frissíti, ha a gép és a telefon
  egy hálón van).
- iPhone-on: Beállítások → Általános → VPN és eszközkezelés → bízz meg a fejlesztőben.

## Használat
1. Nyisd meg az appot, add meg a szerver címét (https://…) és az API-kulcsot (Beállítások oldal).
2. **Indítás**, és engedélyezd az értesítéseket. A „Próbariasztás” gombbal ellenőrizd a hangot (némított telefonnal is).
3. Az app a háttérben csendes hanggal fut; ha az iOS leállítja (pl. újraindítás), nyisd meg újra.

Riasztás: hipó-kockázat (a Cukornapló előrejelzése szerint) vagy 3,0 mmol/L alatti érték; az ismétlés a push-értesítések
beállításával egyezik (alapból 15 percenként, nagyon alacsonynál 5 percenként). 30 percnél régebbi adatnál hangtalan jelzés.
