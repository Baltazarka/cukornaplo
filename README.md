# Cukornapló

Saját webes napló Guardian 4 szenzorhoz és InPen-hez: glükóz, inzulin és szénhidrát egy
helyen, közös időtengelyen. Nuxt 4 (SPA) + Nitro szerver, SQLite (`node:sqlite`).

Nem orvostechnikai eszköz. Kezelési döntéshez az InPen és a Guardian app értékeit használd.

## Funkciók

- **Belépés / jelszó** – `/setup` (első jelszó), `/login`, kilépés. Munkamenet lezárt
  sütiben (bcrypt; a korábbi PHP-s változat `$2y$` hash-e is működik). IP-nkénti
  próbálkozás-korlát: a kliens IP a `CLIENT_IP_HEADER` fejlécből, különben az
  X-Forwarded-For utolsó, proxy által írt eleméből jön, így nem hamisítható. Az első
  jelszóhoz távolról 8 jegyű beállító kód kell (`docker logs`).
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
- **Telefonos beállító varázsló** (`/telefon`): kapcsolatteszt, InPen → Egészség app,
  küldés módja (Health Auto Export / Parancsok), próba élő figyelővel.
- **Adatfogadó API** – `POST /api/ingest` (a régi telefonos beállítások miatt az
  `/api/ingest.php` cím is működik).
- **CareLink** – a Guardian szenzor értékei gondozói fiókkal, háttér-pollerrel
  `CARELINK_INTERVAL` másodpercenként (alapból 300 = 5 perc).
- **Apple Health `export.xml` importáló** (CLI, streamelve):
  `DATA_DIR=... node scripts/import-health-export.ts <export.xml> [kezdő dátum]`.

## Fejlesztés

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

### Adatmappa (`DATA_DIR`)

- Alapértelmezés: a projekt `./data` mappája (nincs verziókezelve).
- Kísérletezéshez külön mappa adható meg, pl. egy demó-példány:

```bash
DATA_DIR=./data-dev CARELINK_INTERVAL=0 pnpm dev
```

A `data-dev` demó-példányhoz beállított jelszó: **`cukor1234`**. Saját jelszóhoz
használd az Adatok → Visszaállítás → *Minden elölről* gombot, majd állíts be újat.

## Docker (Raspberry Pi)

Image build és feltöltés a repó gyökeréből:

```bash
docker buildx build --platform linux/arm64,linux/arm/v7 -t baltazarka/cukornaplo-nuxt:latest --push .
```

Futtatás: a `docker-compose.yml` (vagy ugyanez Portainer-stackként). Környezeti változók:
`DATA_DIR=/data`, `CARELINK_INTERVAL`, `CLIENT_IP_HEADER` (Cloudflare mögött:
`cf-connecting-ip`, és ilyenkor a port kívülről ne legyen közvetlenül elérhető).

> Megjegyzés: az SQLite a Node beépített `node:sqlite` moduljával megy (nincs natív fordítás).
> A Nuxt a `4.5.2`-re van rögzítve: a `4.6.0` Windowson minden oldalt 500-zal dönt
> (nuxt/nuxt#36467), Linuxon/Dockerben nincs ez a hiba.
