// Háttérciklus a push értesítésekhez (hipó-veszély, szénhidrát- és inzulinjavaslat, szenzor és transzmitter) és a bázis
// automatikus beírásához: percenként ellenőriz.
import { checkAlerts, checkDeviceAlerts, checkFpuReminders } from '../utils/notify'
import { learnedAbsorption } from '../utils/absorption'
import { checkBasalAuto } from '../utils/basalAuto'
import { checkAutopilot } from '../utils/autopilot'
import { checkCarbEstimate } from '../utils/carbEstimate'

// Egy ellenőrzést legfeljebb ennyi ideig várunk meg, nehogy egy beragadt hívás
// örökre fennakassza a `running` jelzőt és ezzel a további tickeket.
const CHECK_TIMEOUT_MS = 30_000

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export default defineNitroPlugin(() => {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      // Külön hibakezelés: az egyik ellenőrzés hibája ne akassza meg a többit.
      for (const check of [checkBasalAuto, checkAutopilot, checkCarbEstimate, checkAlerts, checkDeviceAlerts, checkFpuReminders]) {
        try {
          await withTimeout(check(), CHECK_TIMEOUT_MS)
        } catch (e) {
          if (e instanceof Error && e.message === 'timeout') {
            console.error('[notifier]', check.name, 'timeout')
          } else {
            console.error('[notifier]', check.name, e)
          }
        }
      }
    } finally {
      // `finally`, hogy egy innen kiszivárgó hiba se akassza be örökre a jelzőt.
      running = false
    }
  }
  // A tanult felszívódási görbék előmelegítése, hogy az első oldalbetöltés ne várjon rá.
  setTimeout(() => { try { learnedAbsorption() } catch { /* nincs adat */ } }, 10_000)
  setTimeout(tick, 30_000)
  const timer = setInterval(tick, 60_000)
  if (typeof timer.unref === 'function') timer.unref()
})
