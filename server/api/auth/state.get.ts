import { hasPassword, isAuthed, isLocalRequest, setupCode } from '../../utils/auth'
import { hasPasskey } from '../../utils/passkey'
import { viewerOf } from '../../utils/share'

export default defineEventHandler(async (event) => {
  const hasPw = hasPassword()
  // Nyilvános szerveren (nem helyi kérés) jelszó nélkül beállító kód kell.
  const needsSetupCode = !hasPw && !isLocalRequest(event)
  if (needsSetupCode) setupCode() // generálás + naplóba írás
  const authed = await isAuthed(event)
  const viewer = authed ? null : await viewerOf(event)
  return {
    hasPassword: hasPw,
    hasPasskey: hasPasskey(),
    authed,
    needsSetupCode,
    // Megosztási linkkel belépett, csak olvasható megtekintő.
    viewer: viewer ? { expiresAt: viewer.expiresAt } : null,
  }
})
