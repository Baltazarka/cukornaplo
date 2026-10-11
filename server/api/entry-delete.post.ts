// Egy inzulin-, szénhidrát- vagy kézi vércukor-bejegyzés törlése a naplóból (a szenzor mérései nem törölhetők).
import { deleteEntry } from '../utils/db'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const id = Number(body.id)
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen azonosító.' }
  }
  if (!deleteEntry(id)) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'Nincs ilyen törölhető bejegyzés.' }
  }
  return { ok: true }
})
