// A Beállítások oldalon letöltött adatbázis-másolatból (cukornaplo-ÉÉÉÉ-HH-NN.sqlite) helyi elemző adatmappát készít:
//   node scripts/use-export.mjs <export.sqlite> [célmappa = data-real]
// A célmappába kerül a diabetes.sqlite és egy settings.json a másolatban tárolt beállításokkal (terápia, céltartomány,
// bázisadag, felszívódás). Jelszó nincs benne: az első megnyitáskor a beállító oldal kér újat (csak helyben érvényes).
// Futtatás utána: DATA_DIR=data-real CARELINK_INTERVAL=0 PORT=3999 node .output/server/index.mjs
import { copyFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [src, target = 'data-real'] = process.argv.slice(2)
if (!src || !existsSync(src)) {
  console.error('Használat: node scripts/use-export.mjs <export.sqlite> [célmappa]')
  process.exit(1)
}
const dir = resolve(target)
mkdirSync(dir, { recursive: true })
const dbFile = join(dir, 'diabetes.sqlite')
// Egy korábbi futás WAL-naplója nem maradhat ott: az SQLite különben ráolvasná az új másolatra.
for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) rmSync(f, { force: true })
copyFileSync(src, dbFile)

const db = new DatabaseSync(dbFile)
const settings = {}
try {
  for (const r of db.prepare('SELECT key, json FROM export_settings').all()) settings[r.key] = JSON.parse(r.json)
} catch {
  console.error('Ebben a fájlban nincsenek beállítások (export_settings): csak az adatok kerültek át.')
}
const exportedAt = settings.exported_at
delete settings.exported_at
const counts = db.prepare('SELECT type, COUNT(*) n, MIN(ts) a, MAX(ts) b FROM entries GROUP BY type').all()
db.close()
writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2))

const day = (ts) => new Date(Number(ts) * 1000).toISOString().slice(0, 10)
console.log(`Kész: ${dir}`)
if (exportedAt) console.log(`Export ideje: ${new Date(exportedAt * 1000).toLocaleString('hu-HU')}`)
for (const c of counts) console.log(`  ${c.type}: ${c.n} db (${day(c.a)} – ${day(c.b)})`)
console.log(`Beállítások: ${Object.keys(settings).join(', ') || 'nincs'}`)
