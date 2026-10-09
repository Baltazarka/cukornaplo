// Próbaküldés a beállított címre: heti riport most, vagy mintariasztás az aktuális értékekkel.
import { notifySettings, sendWeekly, hypoMail } from '../../utils/notify'
import { predictGlucose } from '../../utils/predict'
import { sendMail, mailConfigured } from '../../utils/mail'

export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const to = notifySettings().email
  if (!to || !mailConfigured()) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Előbb add meg és mentsd az e-mail-címet, és állítsd be az e-mail-küldést.' }
  }
  try {
    if (b.kind === 'weekly') {
      await sendWeekly(to)
    } else {
      const p = predictGlucose(notifySettings().hypoHorizon)
      if (!p) {
        setResponseStatus(event, 400)
        return { ok: false, error: 'Nincs friss vércukorérték vagy terápiás beállítás a mintalevélhez.' }
      }
      const m = hypoMail(p)
      await sendMail(to, `[Minta] ${m.subject}`, m.text, m.html)
    }
    return { ok: true, to }
  } catch (e: any) {
    setResponseStatus(event, 502)
    return { ok: false, error: `A küldés nem sikerült: ${e?.message ?? e}` }
  }
})
