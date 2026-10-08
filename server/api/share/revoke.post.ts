// Megtekintési link visszavonása (a vele belépett megtekintő azonnal kiesik).
import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = Number(((await readBody(event)) ?? {}).id)
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen azonosító.' }
  }
  db().prepare('UPDATE share_tokens SET revoked = 1 WHERE id = ?').run(id)
  return { ok: true }
})
