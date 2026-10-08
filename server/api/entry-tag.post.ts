// Szénhidrát-bejegyzés jelölése: „zsíros / fehérjedús” (subtype = 'fatty'), vagy jelölés nélkül.
// A jelölt étkezések külön látszanak az elemzésben, és kimaradnak a CH-arány becsléséből.
import { db } from '../utils/db'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const id = Number(body.id)
  const tag = body.tag === 'fatty' ? 'fatty' : null
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen azonosító.' }
  }
  const info = db().prepare("UPDATE entries SET subtype = ? WHERE id = ? AND type = 'carbs'").run(tag, id)
  if (Number(info.changes) === 0) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'Nincs ilyen szénhidrát-bejegyzés.' }
  }
  return { ok: true }
})
