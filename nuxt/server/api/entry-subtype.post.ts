// Egy inzulinbejegyzés típusának utólagos átállítása (bólus / bázis / nincs).
import { db } from '../utils/db'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const id = Number(body.id)
  const sub = body.subtype === 'basal' || body.subtype === 'bolus' ? body.subtype : null
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen azonosító.' }
  }
  const info = db().prepare("UPDATE entries SET subtype = ? WHERE id = ? AND type = 'insulin'").run(sub, id)
  if (Number(info.changes) === 0) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'Nincs ilyen inzulinbejegyzés.' }
  }
  return { ok: true }
})
