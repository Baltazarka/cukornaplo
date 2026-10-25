// Adatbázis-másolat letöltése elemzéshez (csak a bejelentkezett tulajdonosnak; a megosztási link nem éri el).
// A másolat a mért adatokat (bejegyzések, jegyzetek, labor) és a számításhoz kellő beállításokat tartalmazza
// (terápia, céltartomány, bázisadag, felszívódási ütem, értesítések). Titok nincs benne: a jelszó-hash, az API-kulcs,
// a CareLink-belépés, a passkey-k, a push-feliratkozások, a megosztási linkek és a belépési napló kimarad.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { db } from '../utils/db'
import { todayYmd } from '../utils/time'

const SECRET_TABLES = ['share_tokens', 'passkeys', 'push_subscriptions', 'login_failures', 'computed_cache']
const SAFE_SETTINGS = ['therapy', 'range_low', 'range_high', 'absorb_rates', 'notify', 'shift']

export default defineEventHandler((event) => {
  const dir = mkdtempSync(join(tmpdir(), 'cukornaplo-export-'))
  const file = join(dir, 'export.sqlite')
  try {
    // Konzisztens pillanatkép a futó adatbázisról.
    db().prepare('VACUUM INTO ?').run(file)
    const out = new DatabaseSync(file)
    try {
      for (const t of SECRET_TABLES) out.exec(`DROP TABLE IF EXISTS ${t}`)
      out.exec('CREATE TABLE export_settings (key TEXT PRIMARY KEY, json TEXT NOT NULL)')
      const ins = out.prepare('INSERT INTO export_settings (key, json) VALUES (?, ?)')
      for (const k of SAFE_SETTINGS) {
        const v = setting(k, null)
        if (v != null) ins.run(k, JSON.stringify(v))
      }
      ins.run('exported_at', JSON.stringify(Math.floor(Date.now() / 1000)))
      out.exec('VACUUM')
    } finally {
      out.close()
    }
    const buf = readFileSync(file)
    setResponseHeaders(event, {
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Disposition': `attachment; filename="cukornaplo-${todayYmd()}.sqlite"`,
      'Cache-Control': 'no-store',
    })
    return buf
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
