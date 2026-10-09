import { removeSubscription } from '../../utils/push'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  removeSubscription(String(b.endpoint ?? ''))
  return { ok: true }
})
