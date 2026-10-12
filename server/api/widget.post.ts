// A telefon widgetjének (Scriptable) adatai és kinézete: legutóbbi vércukor és trend, aktív inzulin (IOB),
// aktív szénhidrát (COB), a görbe és a Telefon oldalon beállított kinézet. Saját X-Token-nel védett
// (mint az adatfogadó), a munkamenet nem kell. POST, hogy a kulcs ne kerülhessen URL-be / naplóba.
import { widgetAuthError, widgetConfig, widgetData } from '../utils/widget'

export default defineEventHandler((event) => {
  const denied = widgetAuthError(event)
  if (denied) return denied
  const config = widgetConfig()
  return { ok: true, ...widgetData(config.lineHours), config, tapPath: WIDGET_TAP_PATHS[config.tap] }
})
