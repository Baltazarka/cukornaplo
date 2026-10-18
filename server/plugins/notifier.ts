// Háttérciklus a push értesítésekhez (hipó-veszély, szénhidrát- és inzulinjavaslat, szenzor és transzmitter): percenként ellenőriz.
import { checkAlerts, checkDeviceAlerts, checkFpuReminders } from '../utils/notify'
import { learnedAbsorption } from '../utils/absorption'

export default defineNitroPlugin(() => {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    // Külön hibakezelés: az egyik ellenőrzés hibája ne akassza meg a többit.
    for (const check of [checkAlerts, checkDeviceAlerts, checkFpuReminders]) {
      try {
        await check()
      } catch (e) {
        console.error('[notifier]', check.name, e)
      }
    }
    running = false
  }
  // A tanult felszívódási görbék előmelegítése, hogy az első oldalbetöltés ne várjon rá.
  setTimeout(() => { try { learnedAbsorption() } catch { /* nincs adat */ } }, 10_000)
  setTimeout(tick, 30_000)
  const timer = setInterval(tick, 60_000)
  if (typeof timer.unref === 'function') timer.unref()
})
