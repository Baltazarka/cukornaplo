import { verifyPassword, loginSession, loginLockedFor, loginFailed, loginSucceeded } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const wait = loginLockedFor(event)
  if (wait > 0) {
    setResponseStatus(event, 429)
    return { ok: false, error: `Túl sok hibás próbálkozás. Próbáld újra ${Math.ceil(wait / 60)} perc múlva.` }
  }
  // A próbálkozás már az ellenőrzés előtt számít (sikeres belépéskor törlődik): így a párhuzamos kérések sem
  // kerülhetik meg a korlátot.
  loginFailed(event)
  const body = (await readBody(event)) ?? {}
  if (await verifyPassword(String(body.password ?? ''))) {
    loginSucceeded(event)
    await loginSession(event, body.remember === true)
    return { ok: true }
  }
  await new Promise((r) => setTimeout(r, 800))
  setResponseStatus(event, 401)
  return { ok: false, error: 'Hibás jelszó.' }
})
