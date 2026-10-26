// Első jelszó beállítása (csak ha még nincs jelszó). Nyilvános szerveren beállító kóddal.
import { hasPassword, setPassword, loginSession, isLocalRequest, setupCodeMatches, loginLockedFor, loginFailed, loginSucceeded } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  if (hasPassword()) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Már van beállított jelszó. Jelentkezz be.' }
  }
  const local = isLocalRequest(event)
  if (!local) {
    if (loginLockedFor(event) > 0) {
      setResponseStatus(event, 429)
      return { ok: false, error: 'Túl sok hibás próbálkozás. Próbáld újra később.' }
    }
    // A próbálkozás az ellenőrzés előtt számít (helyes kódnál törlődik), a párhuzamos kérések miatt.
    loginFailed(event)
  }
  const body = (await readBody(event)) ?? {}
  const p1 = String(body.password ?? '')
  const p2 = String(body.password2 ?? '')

  if (!local) {
    if (!setupCodeMatches(String(body.setup_code ?? ''))) {
      setResponseStatus(event, 403)
      return { ok: false, error: 'Hibás beállító kód.' }
    }
    loginSucceeded(event)
  }

  if (p1.length < 8) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'A jelszó legyen legalább 8 karakter.' }
  }
  if (p1 !== p2) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'A két jelszó nem egyezik.' }
  }

  await setPassword(p1)
  saveSettings({ setup_code: null })
  if (!setting('api_token')) saveSettings({ api_token: newToken() })
  await loginSession(event, true)
  return { ok: true }
})
