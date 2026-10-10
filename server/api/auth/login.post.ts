import { verifyPassword, loginSession, loginLockedFor, loginFailed, loginSucceeded } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const wait = loginLockedFor(event)
  if (wait > 0) {
    setResponseStatus(event, 429)
    return { ok: false, error: `Túl sok hibás próbálkozás. Próbáld újra ${Math.ceil(wait / 60)} perc múlva.` }
  }
  const body = (await readBody(event)) ?? {}
  if (await verifyPassword(String(body.password ?? ''))) {
    loginSucceeded(event)
    await loginSession(event, body.remember === true)
    return { ok: true }
  }
  loginFailed(event)
  await new Promise((r) => setTimeout(r, 800))
  setResponseStatus(event, 401)
  return { ok: false, error: 'Hibás jelszó.' }
})
