// Háttérciklus a push értesítésekhez (hipó-veszély, szénhidrát- és inzulinjavaslat): percenként ellenőriz.
import { checkAlerts } from '../utils/notify'

export default defineNitroPlugin(() => {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await checkAlerts()
    } catch (e) {
      console.error('[notifier]', e)
    } finally {
      running = false
    }
  }
  setTimeout(tick, 30_000)
  const timer = setInterval(tick, 60_000)
  if (typeof timer.unref === 'function') timer.unref()
})
