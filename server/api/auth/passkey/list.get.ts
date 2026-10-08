import { requireAuth } from '../../../utils/auth'
import { listPasskeys } from '../../../utils/passkey'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  return listPasskeys().map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at, lastUsed: p.last_used }))
})
