// A teljes mért adat törlése (bejegyzések). A jelszó, kulcs és CareLink megmarad.
import { db } from '../utils/db'
import { invalidateComputed } from '../utils/jobs'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  if (body.confirm !== true) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Megerősítés szükséges.' }
  }
  const before = (db().prepare('SELECT COUNT(*) c FROM entries').get() as any).c
  db().exec('DELETE FROM entries')
  db().exec('DELETE FROM deleted_entries')
  db().exec('DELETE FROM notes')
  db().exec('DELETE FROM lab_results')
  saveSettings({ last_ingest: null })
  invalidateComputed()
  return { ok: true, deleted: Number(before) }
})
