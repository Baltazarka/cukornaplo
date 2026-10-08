// SQLite a Node beépített node:sqlite moduljával (nincs natív fordítás).
// A séma a korábbi PHP-s változattal azonos, így a régi diabetes.sqlite gond nélkül átvihető.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

let _db: DatabaseSync | null = null

export function db(): DatabaseSync {
  if (_db) return _db
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
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
  _db = d
  return d
}

/** Egy inzulin- vagy CH-bejegyzés törlése; megjegyzi, hogy a telefon ne töltse vissza. */
export function deleteEntry(id: number): boolean {
  const d = db()
  const row = d.prepare("SELECT type, ts, value FROM entries WHERE id = ? AND type IN ('insulin', 'carbs')").get(id) as
    | { type: string; ts: number; value: number }
    | undefined
  if (!row) return false
  d.exec('BEGIN')
  try {
    d.prepare('INSERT OR REPLACE INTO deleted_entries (type, ts, value, deleted_at) VALUES (?, ?, ?, ?)')
      .run(row.type, row.ts, row.value, Math.floor(Date.now() / 1000))
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

/**
 * Mentés; a már meglévő (azonos típus + időpont + érték) és a kézzel törölt sorokat kihagyja.
 * Visszaad [új, kihagyott].
 */
export function storeRows(rows: Row[]): [number, number] {
  const d = db()
  const stmt = d.prepare(
    `INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM deleted_entries WHERE type = ? AND ts = ? AND value = ?)`,
  )
  // Ha a sor már megvan típus nélkül, az újra beküldött típus kitölti (kézzel beállított típust nem ír felül).
  const fill = d.prepare(
    'UPDATE entries SET subtype = ? WHERE type = ? AND ts = ? AND value = ? AND subtype IS NULL',
  )
  const now = Math.floor(Date.now() / 1000)
  let inserted = 0
  d.exec('BEGIN')
  try {
    for (const r of rows) {
      const info = stmt.run(r.type, r.ts, r.value, r.subtype, r.source, now, r.type, r.ts, r.value)
      inserted += Number(info.changes)
      if (Number(info.changes) === 0 && r.subtype !== null) fill.run(r.subtype, r.type, r.ts, r.value)
    }
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  return [inserted, rows.length - inserted]
}
