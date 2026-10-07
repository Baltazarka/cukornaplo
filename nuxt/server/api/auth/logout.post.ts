import { getSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await (await getSession(event)).clear()
  return { ok: true }
})
