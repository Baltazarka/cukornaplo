import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { authSession, loginSession, loginLockedFor, loginFailed, loginSucceeded } from '../../../utils/auth'
import { rpOf, passkeyById, transportsOf } from '../../../utils/passkey'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const wait = loginLockedFor(event)
  if (wait > 0) {
    setResponseStatus(event, 429)
    return { ok: false, error: `Túl sok hibás próbálkozás. Próbáld újra ${Math.ceil(wait / 60)} perc múlva.` }
  }
  // A próbálkozás az ellenőrzés előtt számít (sikeres belépéskor törlődik), a párhuzamos kérések miatt.
  loginFailed(event)
  const body = (await readBody(event)) ?? {}
  const session = await authSession(event)
  const challenge = session.data.challenge
  const row = passkeyById(String(body.response?.id ?? ''))
  await session.update({ challenge: undefined })
  if (!challenge || !row) {
    setResponseStatus(event, 401)
    return { ok: false, error: 'Ismeretlen passkey.' }
  }
  const { rpID, origin } = rpOf(event)
  try {
    const v = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: transportsOf(row) },
    })
    if (!v.verified) throw new Error('nem érvényes')
    db().prepare('UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?')
      .run(v.authenticationInfo.newCounter, Math.floor(Date.now() / 1000), row.id)
    loginSucceeded(event)
    await loginSession(event, body.remember === true)
    return { ok: true }
  } catch {
    setResponseStatus(event, 401)
    return { ok: false, error: 'A passkey-s belépés nem sikerült.' }
  }
})
