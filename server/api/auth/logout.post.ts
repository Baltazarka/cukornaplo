import { authSession, clearRemember } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await (await authSession(event)).clear()
  clearRemember(event)
  return { ok: true }
})
