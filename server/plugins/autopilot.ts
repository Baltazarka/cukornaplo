// Autopilot (külön modul) háttérciklusa: percenként számol, ha be van kapcsolva (lásd utils/autopilot.ts).
import { apTick } from '../utils/autopilot'

export default defineNitroPlugin(() => {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await apTick()
    } catch (e) {
      console.error('[autopilot]', e)
    }
    running = false
  }
  setTimeout(tick, 45_000)
  const timer = setInterval(tick, 60_000)
  if (typeof timer.unref === 'function') timer.unref()
})
