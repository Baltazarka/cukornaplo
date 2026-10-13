// A natív iOS riasztó app adatai: legutóbbi vércukor, hipó-kockázat, javasolt szénhidrát / inzulin és az
// értesítési beállítások (ismétlés, időtáv). Saját X-Token-nel védett (mint a widget), POST, hogy a kulcs ne
// kerüljön URL-be / naplóba. A riasztás döntését az app hozza meg ebből; a számítás ugyanaz, mint a push-értesítésé.
import { widgetAuthError } from '../utils/widget'
import { predictGlucose } from '../utils/predict'
import { notifySettings } from '../utils/notify'
import { latestGlucose } from '../utils/digest'
import { targetRange } from '../utils/range'

export default defineEventHandler((event) => {
  const denied = widgetAuthError(event)
  if (denied) return denied
  const s = notifySettings()
  const now = Math.floor(Date.now() / 1000)
  const p = predictGlucose(s.hypoHorizon, now)
  const latest = p?.now ?? latestGlucose(now)
  const { low, high } = targetRange()
  return {
    ok: true,
    now,
    glucose: latest ? { v: latest.v, ageMin: latest.ageMin, arrow: latest.arrow } : null,
    low,
    high,
    /** A pontszerű előrejelzés csak friss (≤ 15 perces) méréssel és beállított terápiával elérhető. */
    predicted: p != null,
    risk: p?.risk ?? false,
    currentLow: p?.currentLow ?? (latest ? latest.v < low : false),
    treated: p?.treated ?? false,
    nadir: p?.nadir ?? null,
    nadirIn: p?.nadirIn ?? null,
    carbsNeeded: p?.carbsNeeded ?? null,
    insulinNeeded: p?.insulinNeeded ?? null,
    iob: p?.iob ?? null,
    cob: p?.cob ?? null,
    repeatMin: s.repeatMin,
    horizon: s.hypoHorizon,
    insulinMin: s.insulinMin,
    insulinPush: s.insulinPush,
  }
})
