// Az elemzés tárolt (előre kiszámolt) változata: kulcs, számolás és olvasás. Külön fájlban, hogy a felszívódási
// tanulás is használhassa anélkül, hogy az előrejelzés moduljait behúzná.
import { analyze } from './analysis'
import { getComputed, type Computed } from './computed'
import { startOfDayTs, todayYmd, addDaysYmd } from './time'

export const ANALYSIS_DAYS = [7, 14, 30, 60, 90]
const DAY = 86400

/** Az elemzés kulcsa: a mai napra végződőé stabil („today”), a korábbié a végdátummal. */
export function analysisKey(days: number, end: string): string {
  return `analysis:${days}:${end === todayYmd() ? 'today' : end}`
}

export function analysisCompute(days: number, end: string) {
  const start = addDaysYmd(end, -(days - 1))
  return { days, start, end, ...analyze(startOfDayTs(start), startOfDayTs(addDaysYmd(end, 1))) }
}

/** A tárolt (vagy szükség esetén kiszámolt) elemzés. */
export function analysisCached(days: number, end: string): Computed<ReturnType<typeof analysisCompute>> {
  const ttl = end === todayYmd() ? DAY : 7 * DAY
  return getComputed(analysisKey(days, end), ttl, () => analysisCompute(days, end))
}
