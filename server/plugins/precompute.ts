// Háttérszámolás: indulás után a hiányzó eredményeket, majd minden éjjel (04:00 után) mindent újraszámol,
// így a Terápia oldal az utolsó kész eredményt olvassa, és nem számol minden megnyitáskor.
import { warmAll } from '../utils/jobs'
import { readComputed, storeComputed } from '../utils/computed'
import { minuteOfDayInTz, todayYmd } from '../utils/time'

const NIGHT_MIN = 4 * 60

export default defineNitroPlugin(() => {
  let running = false
  const run = async (force: boolean) => {
    if (running) return
    running = true
    try {
      await warmAll(force)
      if (force) storeComputed('nightly', { ymd: todayYmd() })
    } catch (e) {
      console.error('[előszámolás]', e)
    } finally {
      running = false
    }
  }
  // Indulás után egy perccel a hiányzók (a meglévőt nem bántja).
  setTimeout(() => run(false), 60_000)
  const check = () => {
    const done = readComputed<{ ymd: string }>('nightly')?.data.ymd
    if (minuteOfDayInTz(Math.floor(Date.now() / 1000)) >= NIGHT_MIN && done !== todayYmd()) run(true)
  }
  const timer = setInterval(check, 15 * 60_000)
  if (typeof timer.unref === 'function') timer.unref()
})
