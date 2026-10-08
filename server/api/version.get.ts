// Könnyű „változott-e valami” jelzés a felület automatikus frissítéséhez: az adatok és a
// beállítások állapotából képzett bélyeg, és az esetleges CareLink-figyelmeztetés. Percenként kérdezi le a főoldal.
import { db } from '../utils/db'
import { clAlert } from '../utils/carelink'
import { isAuthed } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const e = db().prepare('SELECT COUNT(*) c, MAX(id) mx, MAX(created_at) ca FROM entries').get() as any
  const d = db().prepare('SELECT COUNT(*) c FROM deleted_entries').get() as any
  const n = db().prepare('SELECT COUNT(*) c, MAX(id) mx FROM notes').get() as any
  const s = settings()
  const stamp = [e.c, e.mx, e.ca, d.c, n.c, n.mx, s.therapy?.updatedAt, s.range_low, s.range_high, s.basal_dose].join('|')
  // A CareLink-figyelmeztetés is ezzel a percenkénti kéréssel jut el a főoldalra.
  return { stamp, alert: (await isAuthed(event)) ? clAlert() : null }
})
