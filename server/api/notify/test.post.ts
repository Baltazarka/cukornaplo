// Tesztértesítés a feliratkozott eszközökre: kind = hypo | carbs | insulin (mintaadatokkal).
import { testPayload } from '../../utils/notify'
import { sendPush, listSubscriptions } from '../../utils/push'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const payload = testPayload(String(b.kind ?? ''))
  if (!payload) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Ismeretlen értesítéstípus.' }
  }
  if (!listSubscriptions().length) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Még nincs eszköz feliratkozva az értesítésekre.' }
  }
  const r = await sendPush(payload, { urgency: 'normal', ttl: 120 })
  if (!r.sent) {
    setResponseStatus(event, 502)
    return { ok: false, error: `Az értesítés nem ment ki${r.lastError ? `: ${r.lastError}` : ' (az eszköz előfizetése lejárt, engedélyezd újra).'}` }
  }
  return { ok: true, sent: r.sent, failed: r.failed }
})
