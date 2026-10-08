// Egy inzulinbejegyzés típusának kézi átállítása: étkezési bólus / korrekció / bázis, vagy üres = automatikus.
import { db } from '../utils/db'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const id = Number(body.id)
  const sub = ['basal', 'meal', 'correction'].includes(body.subtype) ? body.subtype : null
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
