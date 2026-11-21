// Napi biztonsági másolat: a teljes adatbázis (VACUUM INTO, konzisztens, WAL-nal is) a data/backup mappába.
// Az utolsó KEEP nap marad. A másolat egészségügyi adat: a „Minden elölről” ezt is törli.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { db } from './db'
import { ymdInTz } from './time'

const KEEP = 7
export const backupDir = () => join(dataDir(), 'backup')

/** Ma még nincs másolat → készít egyet, és törli a régieket. Igaz, ha készült. */
export function backupDaily(): boolean {
  const dir = backupDir()
  const file = join(dir, `diabetes-${ymdInTz(Math.floor(Date.now() / 1000))}.sqlite`)
  if (existsSync(file)) return false
  mkdirSync(dir, { recursive: true })
  db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const old = readdirSync(dir).filter((f) => /^diabetes-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().slice(0, -KEEP)
  for (const f of old) rmSync(join(dir, f), { force: true })
  return true
}

export function backupClear(): void {
  rmSync(backupDir(), { recursive: true, force: true })
}
