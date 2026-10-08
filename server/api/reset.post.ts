// A teljes mért adat törlése (bejegyzések). A jelszó, kulcs és CareLink megmarad.
import { db } from '../utils/db'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  if (body.confirm !== true) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Megerősítés szükséges.' }
  }
  const before = (db().prepare('SELECT COUNT(*) c FROM entries').get() as any).c
  db().exec('DELETE FROM entries')
  db().exec('DELETE FROM deleted_entries')
  saveSettings({ last_ingest: null })
  return { ok: true, deleted: Number(before) }
})
