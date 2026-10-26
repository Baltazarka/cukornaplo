# Cukornapló widget-végpont

Saját iOS widgethez (vagy bármilyen klienshez): a legutóbbi vércukor, a trend, az aktív inzulin és szénhidrát, a javaslatok és a görbe.

## Kérés

```
POST https://<szerver>/api/widget
X-Token: <API-kulcs>
```

- **Kulcs:** a Cukornapló Beállítások oldalán lévő API-kulcs, ugyanaz, mint az adatfeltöltésnél.
- **Miért POST:** a kulcs így nem kerül URL-be vagy naplóba. Törzs nem kell.
- **Hibás vagy hiányzó kulcs:** `401` és `{ "ok": false, "error": "Hibás vagy hiányzó kulcs (X-Token)." }`.
- **Gyakoriság:** az adat 5 percenként frissül (CareLink), ennél sűrűbben fölösleges lekérni.

## Válasz (200)

```json
{
  "ok": true,
  "now": 1793040629,
  "glucose": { "v": 11.8, "ts": 1793040300, "ageMin": 5 },
  "trend": { "dir": 0, "level": 0 },
  "iob": 6.6,
  "cob": 0,
  "suggest": { "insulin": 2.5, "carbs": null },
  "range": { "low": 3.9, "high": 9 },
  "series": [[180, 9.4], [175, 9.6], [5, 11.7], [0, 11.8]],
  "config": {
    "lineHours": 3,
    "fontSize": 38,
    "colors": { "inRange": "#ff7ad9", "low": "#ff5d5d", "high": "#ffb454", "cob": "#2fbf8a", "iob": "#4a8cff", "bg": "#0f1115" }
  }
}
```

| Mező | Típus | Jelentés |
|---|---|---|
| `now` | szám | A szerver ideje, unix másodperc. |
| `glucose` | objektum vagy `null` | Az utolsó szenzorérték. `null`, ha az utolsó `lineHours` órában nincs szenzoradat. |
| `glucose.v` | szám | mmol/L, egy tizedes. A szenzor határán 2,2 (valójában lehet alacsonyabb, írd ki: „<2,2”) vagy 22,2 („>22,2”). |
| `glucose.ts` | szám | A mérés ideje, unix másodperc. Az alsó „mmol/L · 19:22” sor ebből jön. |
| `glucose.ageMin` | szám | Hány perce mért. 15–20 percnél régebbi értéket érdemes halványan vagy figyelmeztetéssel mutatni. |
| `trend` | objektum vagy `null` | `dir`: −1 esik, 0 stabil, 1 emelkedik. `level`: 1 lassan, 2 közepesen, 3 gyorsan. `null`: kevés adat. |
| `iob` | szám vagy `null` | Aktív (még ható) gyors inzulin, E, egy tizedes. `null`, ha nincs terápiás beállítás. A bázis nem számít bele. |
| `cob` | szám | Aktív (még fel nem szívódott) szénhidrát, g, egész. |
| `suggest.insulin` | szám vagy `null` | Inzulinjavaslat, E, 0,5-re kerekítve. Csak akkor van, ha a cukor a céltartomány fölött van, és a push-értesítés feltételei teljesülnek (nincs hipó-veszély, nem esik, legalább egy órája nem volt bólus, kevés az aktív inzulin, és legalább akkora, mint a beállított legkisebb javasolt adag). |
| `suggest.carbs` | szám vagy `null` | Szénhidrát-javaslat, g, 5-re kerekítve, 10–30 között. Csak hipó-veszélynél van. |
| `range.low`, `range.high` | szám | A céltartomány, mmol/L. Ehhez színezz: alatta `colors.low`, fölötte `colors.high`, benne `colors.inRange`. |
| `series` | tömb | A görbe a vonalhoz: `[hány perce, mmol/L]` párok, időrendben (a legrégebbitől a mostaniig), kb. 5 percenként, a `lineHours` órára. |
| `config` | objektum | A Cukornapló Telefon oldalán beállított kinézet: a vonal hossza órában (1, 3 vagy 6), a cukor betűmérete (pont) és a színek (hex). |

A javaslatok csak friss (20 percnél nem régebbi) szenzorértékből számolódnak, különben mindkettő `null`. A két javaslat egyszerre nem fordul elő.

## Ajánlott megjelenítés (a Scriptable-widget így csinálja)

- **Bal oldalon:** nagy számmal a cukor, mellette a trendnyíl. `dir` 0: →. Lassan ↗ / ↘, közepesen ↑ / ↓, gyorsan ⇈ / ⇊.
- **Jobb oldalon alapból:** `CH {cob} g` (`colors.cob`) és `B {iob} E` (`colors.iob`).
- **Ha van javaslat:** 🍗 `{carbs} g` (`colors.cob`) és kék fecskendő (SF Symbol `syringe.fill`) `{insulin} E` (`colors.iob`).
- **Váltakozás:** ha közben aktív inzulin vagy CH is van (`iob` > 0 vagy `cob` > 0), frissítésenként (kb. 5 percenként) váltogass a javaslat és az aktív értékek között. A Scriptable-widget ezt így számolja: `Math.floor(Date.now() / 300000) % 2 === 0` esetén javaslat.
- **Alul:** a görbe a céltartomány halvány sávjával, és „mmol/L · ÓÓ:PP” (a `glucose.ts` helyi idővel).

A javaslatok tájékoztató jellegűek, ugyanazok, mint a push-értesítéseké; a beadott adagról a felhasználó dönt.
