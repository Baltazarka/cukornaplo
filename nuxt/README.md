# Cukornapló – Nuxt 4 verzió

A PHP app fokozatos átírása Nuxt 4-re, dinamikusabb, kombinált adatmegjelenítéssel.
A szerveroldal (Nitro) ugyanazt az SQLite-sémát és `settings.json`-t használja, mint a PHP.

## Mi van kész

- **Belépés / jelszó** – `/setup` (első jelszó), `/login`, kilépés. Munkamenet lezárt
  sütiben (bcrypt, a PHP $2y$ hash-sel is kompatibilis), IP-nkénti próbálkozás-korlát.
  Az `/api/**` végpontok munkamenethez kötöttek (kivéve az adatfogadót, ami X-Token).
- **Napi nézet** (`/`): három összehangolt panel közös időtengelyen (glükóz / inzulin /
  szénhidrát) – az időpontok pontosan egymás alá esnek, egyesített tooltippel. A glükóz
  panelen céltartomány-sáv, alatta piros / felette sárga kiemelés, bal oldalt „utolsó
  aktív vércukor”. **Állítható céltartomány** (a fejlécben, a `settings.json`-ba mentve).
  Tile-ok, napló, idő-a-tartományokban, GMI/CV, 14 napos összesítő.
- **Adatok és import** (`/adatok`): tárolt adatok, API-kulcs (+ új kulcs), CareLink
  **összekötő UI** (belépési cím, kód beillesztése, lekérés most, páciensváltás, nyers
  válasz letöltése, bontás), **kézi import**, és a **Visszaállítás** zóna:
  *mért adatok törlése* és *minden elölről (gyári visszaállítás)*.
- **Adatfogadó API** – `POST /api/ingest` (és a visszafelé kompatibilis `/api/ingest.php`).
- **CareLink** – teljes kliens portolva, háttér-poller `CARELINK_INTERVAL` másodpercenként
  (alapból 300 = 5 perc). Javítva: átmeneti 401/403 már nem bontja a kapcsolatot.

- **Telefonos beállító varázsló** (`/telefon`): a PHP `setup.php` lépéseinek portja
  (kapcsolatteszt, InPen, küldés módja – Health Auto Export / Parancsok, próba élő figyelővel).
- **Apple Health `export.xml` importáló** (CLI, streamelve):
  `DATA_DIR=... node scripts/import-health-export.ts <export.xml> [kezdő dátum]`.

## Teljes paritás a PHP appal

Minden eredeti funkció portolva: napi nézet, telefonos küldés (API + varázsló),
CareLink (összekötő UI + 5 perces poller), kézi import, Apple Health export, jelszó,
adat- és gyári visszaállítás.

## Belépés a demóhoz (data-dev)

A `data-dev` demó-példányhoz beállított jelszó: **`cukor1234`**. Saját jelszóhoz
használd az Adatok → Visszaállítás → *Minden elölről* gombot, majd állíts be újat.

## Futtatás

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

### Adatmappa (`DATA_DIR`)

- Alapértelmezés: a projekt melletti `../data` – a **meglévő, valódi** SQLite + settings.json,
  amit a PHP is használ.
- Biztonságos kísérletezéshez külön mappa adható meg, pl. a demóhoz használt `data-dev`:

```bash
DATA_DIR=./data-dev CARELINK_INTERVAL=0 pnpm dev
```

- Dockerben a `DATA_DIR=/data` és `CARELINK_INTERVAL` környezeti változóval állítható.

> Megjegyzés: az SQLite a Node beépített `node:sqlite` moduljával megy (nincs natív fordítás).
> A Nuxt a `4.5.2`-re van rögzítve: a `4.6.0` Windowson minden oldalt 500-zal dönt
> (nuxt/nuxt#36467), Linuxon/Dockerben nincs ez a hiba.
