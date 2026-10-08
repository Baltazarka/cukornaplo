// Minden elölről: a mért adatok ÉS az összes beállítás (jelszó, kulcs, CareLink) törlése.
import { db } from '../utils/db'
import { resetSettings } from '../utils/settings'
import { authSession } from '../utils/auth'
import { CL_RAW_FILE } from '../utils/carelink'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  if (body.confirm !== true) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Megerősítés szükséges.' }
  }
  db().exec('DELETE FROM entries')
  db().exec('DELETE FROM deleted_entries')
  db().exec('DELETE FROM notes')
  db().exec('DELETE FROM lab_results')
  db().exec('DELETE FROM share_tokens')
  db().exec('DELETE FROM login_failures')
  resetSettings()
  try {
    unlinkSync(join(dataDir(), CL_RAW_FILE))
  } catch { /* nincs ilyen fájl */ }
  await (await authSession(event)).clear()
  return { ok: true }
})
