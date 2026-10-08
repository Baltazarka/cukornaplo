// Új passkey regisztrálásának indítása (csak bejelentkezve).
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { authSession, requireAuth } from '../../../utils/auth'
import { RP_NAME, USER_NAME, USER_ID, rpOf, listPasskeys, transportsOf } from '../../../utils/passkey'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { rpID } = rpOf(event)
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: USER_NAME,
    userDisplayName: RP_NAME,
    userID: USER_ID,
    attestationType: 'none',
    excludeCredentials: listPasskeys().map((p) => ({ id: p.id, transports: transportsOf(p) })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  })
  await (await authSession(event)).update({ challenge: options.challenge })
  return options
})
