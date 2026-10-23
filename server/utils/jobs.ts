// A Terápia oldal nehéz számolásai: kulcsok, kényszerített újraszámolás és az éjszakai / indítás utáni előszámolás.
import { analysisKey, analysisCompute, ANALYSIS_DAYS } from './analysisCache'
import { accuracyJob } from './predictAccuracy'
import { readComputed, computeNow, getComputed, clearComputed, type Computed } from './computed'
import { resetAbsorptionCache } from './absorption'
import { resetPredictChoice } from './predict'
import { todayYmd } from './time'

export const ACCURACY_DAYS = [7, 14, 30]
const DAY = 86400

export const accuracyKey = (days: number) => `predict-accuracy:${days}`

export function accuracyCached(days: number): Computed<ReturnType<typeof accuracyJob>> {
  return getComputed(accuracyKey(days), DAY, () => accuracyJob(days))
}

/** Kényszerített újraszámolás (Újraszámolás gomb). Visszaadja a számolás időpontját. */
export function recompute(kind: 'analysis' | 'accuracy', days: number, end = todayYmd()): number {
  if (kind === 'analysis') {
    const at = computeNow(analysisKey(days, end), () => analysisCompute(days, end)).at
    resetAbsorptionCache() // a tanult felszívódási görbék a 60 napos elemzésből jönnek
    return at
  }
  return computeNow(accuracyKey(days), () => accuracyJob(days)).at
}

let warmTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Adat vagy beállítás változása után: a tárolt eredmények érvénytelenek. A memóriabeli gyorsítótárak (tanult
 * felszívódás, módszerválasztás) is ürülnek; teljes törlésnél az előszámolás kis késéssel a háttérben újraindul.
 */
export function invalidateComputed(prefix = ''): void {
  clearComputed(prefix)
  resetAbsorptionCache()
  resetPredictChoice()
  if (prefix === '') {
    clearTimeout(warmTimer)
    warmTimer = setTimeout(() => {
      warmAll(true).catch((e) => console.error('[előszámolás]', e))
    }, 10_000)
    warmTimer.unref?.()
  }
}

const pause = () => new Promise<void>((r) => setTimeout(r, 300))

/** Minden előszámolása egymás után, közben szünetekkel, hogy a szerver ne akadjon el. `force`: meglévőt is újraszámol. */
export async function warmAll(force: boolean): Promise<void> {
  const today = todayYmd()
  const jobs: [string, () => void][] = []
  for (const d of ANALYSIS_DAYS) jobs.push([analysisKey(d, today), () => recompute('analysis', d, today)])
  for (const d of ACCURACY_DAYS) jobs.push([accuracyKey(d), () => recompute('accuracy', d)])
  for (const [key, run] of jobs) {
    if (!force && readComputed(key)) continue
    try {
      run()
    } catch (e) {
      console.error('[előszámolás]', key, e)
    }
    await pause()
  }
}
