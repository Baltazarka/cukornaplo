// Tesztértesítés az összes feliratkozott eszközre.
import { sendPush, listSubscriptions } from '../../utils/push'

export default defineEventHandler(async (event) => {
  if (!listSubscriptions().length) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Még nincs eszköz feliratkozva az értesítésekre.' }
  }
  const r = await sendPush({ title: 'Cukornapló – teszt', body: 'Az értesítés működik. Így fog szólni a hipó-riasztás.', url: '/', tag: 'test' }, { urgency: 'normal', ttl: 120 })
  if (!r.sent) {
    setResponseStatus(event, 502)
    return { ok: false, error: `Az értesítés nem ment ki${r.lastError ? `: ${r.lastError}` : ' (az eszköz előfizetése lejárt, engedélyezd újra).'}` }
  }
  return { ok: true, sent: r.sent, failed: r.failed }
})
