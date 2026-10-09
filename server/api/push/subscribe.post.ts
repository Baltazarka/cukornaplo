import { validSubscription, saveSubscription } from '../../utils/push'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  if (!validSubscription(b.subscription)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen előfizetés.' }
  }
  saveSubscription(b.subscription, String(b.name ?? '').trim().slice(0, 60) || 'Eszköz')
  return { ok: true }
})
