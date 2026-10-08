import { authSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await (await authSession(event)).clear()
  return { ok: true }
})
