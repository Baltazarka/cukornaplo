// A telefon widgetjének (Scriptable) adatai és kinézete: legutóbbi vércukor és trend, aktív inzulin (IOB),
// aktív szénhidrát (COB), a görbe és a Telefon oldalon beállított kinézet. Saját X-Token-nel védett
// (mint az adatfogadó), a munkamenet nem kell. POST, hogy a kulcs ne kerülhessen URL-be / naplóba.
import { timingSafeEqual } from 'node:crypto'
import { widgetConfig, widgetData } from '../utils/widget'

export default defineEventHandler((event) => {
  const token = String(getHeader(event, 'x-token') ?? '').trim()
  const expected = String(setting('api_token', '') ?? '')
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (expected === '' || a.length !== b.length || !timingSafeEqual(a, b)) {
    setResponseStatus(event, 401)
    return { ok: false, error: 'Hibás vagy hiányzó kulcs (X-Token).' }
  }
  const config = widgetConfig()
  return { ok: true, ...widgetData(config.lineHours), config, tapPath: WIDGET_TAP_PATHS[config.tap] }
})
