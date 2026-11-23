// A teljes mért adat törlése (bejegyzések). A jelszó, kulcs és CareLink megmarad.
import { db } from '../utils/db'
import { invalidateComputed } from '../utils/jobs'
import { confirmPassword } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  if (body.confirm !== true) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Megerősítés szükséges.' }
  }
  const denied = await confirmPassword(event, String(body.password ?? ''))
  if (denied) return { ok: false, error: denied }
  const before = (db().prepare('SELECT COUNT(*) c FROM entries').get() as any).c
  db().exec('DELETE FROM entries')
  db().exec('DELETE FROM deleted_entries')
  db().exec('DELETE FROM notes')
  db().exec('DELETE FROM lab_results')
  db().exec('DELETE FROM excluded_ranges')
  db().exec('DELETE FROM autopilot_suggestions')
  db().exec('DELETE FROM carb_estimates')
  saveSettings({ last_ingest: null })
  invalidateComputed()
  return { ok: true, deleted: Number(before) }
})
