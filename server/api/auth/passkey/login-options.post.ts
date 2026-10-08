// Belépés passkey-vel: kihívás kérése (nyilvános). Az eszköz maga választja ki a passkey-t.
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { authSession } from '../../../utils/auth'
import { rpOf, hasPasskey } from '../../../utils/passkey'

export default defineEventHandler(async (event) => {
  if (!hasPasskey()) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Nincs regisztrált passkey.' }
  }
  const options = await generateAuthenticationOptions({ rpID: rpOf(event).rpID, userVerification: 'required' })
  await (await authSession(event)).update({ challenge: options.challenge })
  return options
})
