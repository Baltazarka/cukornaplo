import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { authSession, requireAuth } from '../../../utils/auth'
import { rpOf } from '../../../utils/passkey'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const body = (await readBody(event)) ?? {}
  const session = await authSession(event)
  const challenge = session.data.challenge
  if (!challenge) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Lejárt a kérés, próbáld újra.' }
  }
  await session.update({ challenge: undefined })
  const { rpID, origin } = rpOf(event)
  try {
    const v = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
    if (!v.verified) throw new Error('A regisztráció nem érvényes.')
    const c = v.registrationInfo.credential
    const name = String(body.name ?? '').trim().slice(0, 60) || 'Passkey'
    db().prepare('INSERT INTO passkeys (id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.id, c.publicKey, c.counter, (c.transports ?? []).join(','), name, Math.floor(Date.now() / 1000))
    return { ok: true }
  } catch (e: any) {
    setResponseStatus(event, 400)
    return { ok: false, error: `A passkey regisztrálása nem sikerült: ${e?.message ?? e}` }
  }
})
