// Belépés megosztási linkkel: érvényes token esetén csak olvasható megtekintői munkamenet.
// Ha a tulajdonos már be van jelentkezve ebben a böngészőben, a munkamenetét nem írjuk felül.
import { authSession, isAuthed } from '../../utils/auth'
import { findShare } from '../../utils/share'
import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  if (await isAuthed(event)) return { ok: true, owner: true }
  const share = findShare(String(((await readBody(event)) ?? {}).token ?? ''))
  if (!share) {
    await new Promise((r) => setTimeout(r, 500))
    setResponseStatus(event, 401)
    return { ok: false, error: 'A link lejárt vagy érvénytelen.' }
  }
  const session = await authSession(event)
  await session.update({ auth: false, viewer: { id: share.id } })
  db().prepare('UPDATE share_tokens SET used_at = COALESCE(used_at, ?) WHERE id = ?').run(Math.floor(Date.now() / 1000), share.id)
  return { ok: true, expiresAt: share.expiresAt }
})
