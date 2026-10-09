// Háttérciklus az e-mailes értesítésekhez (hipó-előjelzés, heti riport): percenként ellenőriz.
import { checkHypoAlert, checkWeekly } from '../utils/notify'

export default defineNitroPlugin(() => {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await checkHypoAlert()
      await checkWeekly()
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
