// Egy inzulin- vagy szénhidrát-bejegyzés törlése a naplóból (glükózt nem lehet így törölni).
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
    return { ok: false, error: 'Nincs ilyen inzulin- vagy CH-bejegyzés.' }
  }
  return { ok: true }
})
