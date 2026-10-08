import { requireAuth } from '../../../utils/auth'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const b = (await readBody(event)) ?? {}
  db().prepare('DELETE FROM passkeys WHERE id = ?').run(String(b.id ?? ''))
  return { ok: true }
})
