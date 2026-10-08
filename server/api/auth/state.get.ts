import { hasPassword, isAuthed, isLocalRequest, setupCode } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const hasPw = hasPassword()
  // Nyilvános szerveren (nem helyi kérés) jelszó nélkül beállító kód kell.
  const needsSetupCode = !hasPw && !isLocalRequest(event)
  if (needsSetupCode) setupCode() // generálás + naplóba írás
  return {
    hasPassword: hasPw,
    authed: await isAuthed(event),
    needsSetupCode,
  }
})
