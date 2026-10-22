// SQLite a Node beépített node:sqlite moduljával (nincs natív fordítás).
// A séma a korábbi PHP-s változattal azonos, így a régi diabetes.sqlite gond nélkül átvihető.
import type { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

let _db: DatabaseSync | null = null

/**
 * A node:sqlite betöltése. A Node 22 betöltéskor „ExperimentalWarning: SQLite is an experimental
 * feature” figyelmeztetést ír, amit a Nuxt dev szerver ERROR-ként mutat. Csak ezt az egyet némítjuk el.
 */
function loadSqlite(): typeof import('node:sqlite') {
  const original = process.emitWarning
  process.emitWarning = ((warning: any, ...args: any[]) => {
    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type ?? warning?.name
    if (type === 'ExperimentalWarning' && String(warning?.message ?? warning).includes('SQLite')) return
    return (original as any).call(process, warning, ...args)
  }) as typeof process.emitWarning
  try {
    return createRequire(import.meta.url)('node:sqlite')
  } finally {
    process.emitWarning = original
  }
}

export function db(): DatabaseSync {
  if (_db) return _db
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  const { DatabaseSync } = loadSqlite()
  const d = new DatabaseSync(join(dir, 'diabetes.sqlite'))
  d.exec('PRAGMA journal_mode = WAL')
  d.exec('PRAGMA busy_timeout = 5000')
  d.exec(`CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('glucose', 'insulin', 'carbs')),
    ts INTEGER NOT NULL,
    value REAL NOT NULL,
    subtype TEXT,
    source TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (type, ts, value)
  )`)
  d.exec('CREATE INDEX IF NOT EXISTS entries_type_ts ON entries (type, ts)')
  // Zsíros / fehérjedús étkezésnél a CH-bejegyzéshez megadott zsír és fehérje, g (a zsír-fehérje javaslathoz és a
  // saját % becsléséhez). Régi adatbázisban hiányzik: hozzáadjuk.
  const cols = new Set((d.prepare('PRAGMA table_info(entries)').all() as { name: string }[]).map((c) => c.name))
  if (!cols.has('fat')) d.exec('ALTER TABLE entries ADD COLUMN fat REAL')
  if (!cols.has('protein')) d.exec('ALTER TABLE entries ADD COLUMN protein REAL')
  // Kizárt szenzorérték (pl. ráfekvés): a jelölt szakaszban 1, minden számolásból kimarad (utils/excluded.ts).
  if (!cols.has('excluded')) d.exec('ALTER TABLE entries ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0')
  d.exec(`CREATE TABLE IF NOT EXISTS excluded_ranges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_ts INTEGER NOT NULL,
    to_ts INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  d.exec('CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, ts INTEGER NOT NULL)')
  // Kézzel törölt bejegyzések. A telefon a következő küldésnél újra elküldené őket
  // (mindig az utolsó napokat küldi), ezért a beírás ezeket kihagyja.
  d.exec(`CREATE TABLE IF NOT EXISTS deleted_entries (
    type TEXT NOT NULL,
    ts INTEGER NOT NULL,
    value REAL NOT NULL,
    deleted_at INTEGER NOT NULL,
    PRIMARY KEY (type, ts, value)
  )`)
  // Jegyzetek (sport, betegség, szenzorcsere stb. címkékkel és szabad szöveggel).
  d.exec(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`)
  d.exec('CREATE INDEX IF NOT EXISTS notes_ts ON notes (ts)')
  // Ideiglenes, csak olvasható megtekintési linkek (a token csak hash-ként tárolva).
  d.exec(`CREATE TABLE IF NOT EXISTS share_tokens (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    used_at INTEGER
  )`)
  // Passkey-k (Face ID / Touch ID): csak a nyilvános kulcs van itt, a privát kulcs az eszközön marad.
  d.exec(`CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_used INTEGER
  )`)
  // Web Push előfizetések (iPhone / böngésző értesítések); a végpont az eszköz azonosítója.
  d.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`)
  // Kiküldött push értesítések naplója (a főoldalon visszanézhető, ha egy értesítés elsikkadt).
  d.exec(`CREATE TABLE IF NOT EXISTS push_log (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    tag TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0
  )`)
  d.exec('CREATE INDEX IF NOT EXISTS push_log_ts ON push_log (ts)')
  // Laboreredmények: HbA1c (%), a GMI-vel összevetéshez.
  d.exec(`CREATE TABLE IF NOT EXISTS lab_results (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    hba1c REAL NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  // Előre kiszámolt, nehéz eredmények (elemzés, előrejelzés-teszt): a Terápia oldal ezeket olvassa.
  d.exec(`CREATE TABLE IF NOT EXISTS computed_cache (
    key TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    json TEXT NOT NULL
  )`)
  _db = d
  return d
}

/** Egy inzulin- vagy CH-bejegyzés törlése; megjegyzi, hogy a telefon ne töltse vissza. */
export function deleteEntry(id: number): boolean {
  const d = db()
  // Inzulin- és CH-sor, vagy a kézzel felvitt vércukor törölhető (a szenzor mérései nem).
  const row = d.prepare("SELECT type, ts, value FROM entries WHERE id = ? AND (type IN ('insulin', 'carbs') OR (type = 'glucose' AND source = 'manual'))").get(id) as
    | { type: string; ts: number; value: number }
    | undefined
  if (!row) return false
  d.exec('BEGIN')
  try {
    // A telefon később nem töltheti vissza az inzulin- és CH-sort; a kézi vércukornak nincs külső forrása.
    if (row.type !== 'glucose') {
      d.prepare('INSERT OR REPLACE INTO deleted_entries (type, ts, value, deleted_at) VALUES (?, ?, ?, ?)')
        .run(row.type, row.ts, row.value, Math.floor(Date.now() / 1000))
    }
    d.prepare('DELETE FROM entries WHERE id = ?').run(id)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  return true
}

export interface Row {
  type: 'glucose' | 'insulin' | 'carbs'
  ts: number
  value: number
  subtype: string | null
  source: string | null
}

/** A naplóba kézzel felvett inzulin / CH forrása. */
export const MANUAL_SOURCE = 'manual'
/** Ennyi időn belül azonos típusú és mennyiségű beérkező adat a kézi bejegyzés „párja”. */
export const MANUAL_MATCH_SEC = 30 * 60
/** Ennyi másodpercen belüli, szinte azonos szenzorérték ugyanaz a mérés (más úton érkezett). */
export const GLUCOSE_DUP_SEC = 150

/**
 * Mentés; a már meglévő (azonos típus + időpont + érték) és a kézzel törölt sorokat kihagyja.
 * Visszaad [új, kihagyott].
 */
export function storeRows(rows: Row[]): [number, number] {
  const d = db()
  // Kézi bejegyzés párja: ha az InPen / Health később ugyanazt az adagot küldi, a beérkező sor
  // megmarad (pontosabb időpont), a kézi törlődik; a kézzel beállított típust / jelölést átvesszük.
  const manualMatch = d.prepare(
    'SELECT id, subtype, fat, protein FROM entries WHERE source = ? AND type = ? AND value = ? AND ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) LIMIT 1',
  )
  // A kézi sor zsír / fehérje adata is átkerül a beérkező sorra.
  const copyMacros = d.prepare('UPDATE entries SET fat = ?, protein = ? WHERE type = ? AND ts = ? AND value = ?')
  const dropManual = d.prepare('DELETE FROM entries WHERE id = ?')
  const stmt = d.prepare(
    `INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM deleted_entries WHERE type = ? AND ts = ? AND value = ?)`,
  )
  // Ha a sor már megvan típus nélkül, az újra beküldött típus kitölti (kézzel beállított típust nem ír felül).
  const fill = d.prepare(
    'UPDATE entries SET subtype = ? WHERE type = ? AND ts = ? AND value = ? AND subtype IS NULL',
  )
  // Ugyanaz a szenzormérés két úton is beérkezhet (CareLink és Apple Health), a percre kerekített és a pontos
  // időponttal: 2,5 percen belüli, szinte azonos szenzorértéket nem veszünk fel még egyszer.
  const nearGlucose = d.prepare(
    "SELECT 1 FROM entries WHERE type = 'glucose' AND ts BETWEEN ? AND ? AND ABS(value - ?) <= 0.2 + 1e-9 AND (source IS NULL OR source != ?) LIMIT 1",
  )
  // A szenzor 5 percenként mér: ugyanarra az időpontra (±2,5 perc) a CareLinkből csak egy érték lehet. Más értékű,
  // közeli sor eltolt időpontú másolat (pl. téves időzóna-javítás), nem vesszük fel.
  const sameSlot = d.prepare(
    "SELECT 1 FROM entries WHERE type = 'glucose' AND source = 'CareLink' AND ts BETWEEN ? AND ? LIMIT 1",
  )
  // Kizárt szakaszba (pl. késve érkező) szenzorérték is kizárva kerül be.
  const markExcluded = d.prepare(
    "UPDATE entries SET excluded = 1 WHERE type = 'glucose' AND ts = ? AND value = ? AND EXISTS (SELECT 1 FROM excluded_ranges x WHERE ? BETWEEN x.from_ts AND x.to_ts)",
  )
  const now = Math.floor(Date.now() / 1000)
  let inserted = 0
  d.exec('BEGIN')
  try {
    for (const r of rows) {
      if (r.type === 'glucose' && r.source !== MANUAL_SOURCE && nearGlucose.get(r.ts - GLUCOSE_DUP_SEC, r.ts + GLUCOSE_DUP_SEC, r.value, MANUAL_SOURCE)) continue
      if (r.type === 'glucose' && r.source === 'CareLink' && sameSlot.get(r.ts - GLUCOSE_DUP_SEC, r.ts + GLUCOSE_DUP_SEC)) continue
      const manual = r.type !== 'glucose' && r.source !== MANUAL_SOURCE
        ? manualMatch.get(MANUAL_SOURCE, r.type, r.value, r.ts - MANUAL_MATCH_SEC, r.ts + MANUAL_MATCH_SEC, r.ts) as { id: number; subtype: string | null; fat: number | null; protein: number | null } | undefined
        : undefined
      // A beérkező általános „bolus” jelölésnél a kézi (étkezési / korrekció / bázis / zsíros / gyors) a pontosabb.
      const sub = manual?.subtype && (r.subtype == null || r.subtype === 'bolus') ? manual.subtype : r.subtype
      const info = stmt.run(r.type, r.ts, r.value, sub, r.source, now, r.type, r.ts, r.value)
      inserted += Number(info.changes)
      if (r.type === 'glucose' && r.source !== MANUAL_SOURCE && Number(info.changes) > 0) markExcluded.run(r.ts, r.value, r.ts)
      if (manual && Number(info.changes) > 0) {
        if (manual.fat != null || manual.protein != null) copyMacros.run(manual.fat, manual.protein, r.type, r.ts, r.value)
        dropManual.run(manual.id)
      }
      if (Number(info.changes) === 0 && r.subtype !== null) fill.run(r.subtype, r.type, r.ts, r.value)
    }
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  return [inserted, rows.length - inserted]
}
