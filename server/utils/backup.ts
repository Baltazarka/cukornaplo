// Napi biztonsági másolat: a teljes adatbázis (VACUUM INTO, konzisztens, WAL-nal is) és a settings.json (terápia, műszak,
// jelszó-hash, kulcsok) a data/backup mappába.
// Az utolsó KEEP nap marad. A „Minden elölről” a mentéseket NEM törli (hogy egy téves törlés visszafordítható legyen).
// Visszaállítás: állítsd le a szervert, másold a kívánt mentést a data/diabetes.sqlite helyére (és a settings-…json-t
// settings.json néven), és töröld a mellette lévő diabetes.sqlite-wal és diabetes.sqlite-shm fájlt.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { staleBackups } from '#shared/utils/backupKeep'
import { db } from './db'
import { minuteOfDayInTz, ymdInTz } from './time'

const KEEP = 7
/** Éjjel 3 óra előtt nem fut (a szinkron másolás ilyenkor a legkevésbé zavar). */
const FROM_MINUTE = 3 * 60

/** Ma még nincs másolat → készít egyet, és törli a régieket. Igaz, ha készült. */
export function backupDaily(): boolean {
  const now = Math.floor(Date.now() / 1000)
  const dir = join(dataDir(), 'backup')
  const file = join(dir, `diabetes-${ymdInTz(now)}.sqlite`)
  if (existsSync(file) || minuteOfDayInTz(now) < FROM_MINUTE) return false
  mkdirSync(dir, { recursive: true })
  // Előbb ideiglenes fájlba, a végén átnevezve: egy megszakadt másolat nem számít mai mentésnek.
  const tmp = `${file}.tmp`
  rmSync(tmp, { force: true })
  db().prepare('VACUUM INTO ?').run(tmp)
  renameSync(tmp, file)
  try {
    copyFileSync(join(dataDir(), 'settings.json'), join(dir, `settings-${ymdInTz(now)}.json`))
  } catch { /* még nincs beállításfájl */ }
  for (const f of staleBackups(readdirSync(dir), KEEP)) rmSync(join(dir, f), { force: true })
  return true
}
