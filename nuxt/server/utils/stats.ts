// Glükóz-statisztika: a lib.php glucose_stats() átírása.
import { MGDL_PER_MMOL } from './normalize'

export const RANGE_VERY_LOW = 3.0
export const RANGE_LOW = 3.9
export const RANGE_HIGH = 10.0
export const RANGE_VERY_HIGH = 13.9

export interface GlucoseStats {
  n: number
  avg?: number
  sd?: number
  cv?: number
  min?: number
  max?: number
  gmi?: number
  pct?: Record<'veryLow' | 'low' | 'inRange' | 'high' | 'veryHigh', number>
}

export function glucoseStats(values: number[], low = RANGE_LOW, high = RANGE_HIGH): GlucoseStats {
  const n = values.length
  if (n === 0) return { n: 0 }
  const sum = values.reduce((a, b) => a + b, 0)
  const avg = sum / n
  let varSum = 0
  for (const v of values) varSum += (v - avg) ** 2
  const sd = n > 1 ? Math.sqrt(varSum / (n - 1)) : 0
  const bands = { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0 }
  for (const v of values) {
    if (v < RANGE_VERY_LOW) bands.veryLow++
    else if (v < low) bands.low++
    else if (v <= high) bands.inRange++
    else if (v <= RANGE_VERY_HIGH) bands.high++
    else bands.veryHigh++
  }
  const pct = {} as GlucoseStats['pct'] & object
  for (const k of Object.keys(bands) as (keyof typeof bands)[]) pct[k] = (100 * bands[k]) / n
  return {
    n, avg, sd,
    cv: avg > 0 ? (100 * sd) / avg : 0,
    min: Math.min(...values),
    max: Math.max(...values),
    // GMI (Bergenstal 2018): 3,31 + 0,02392 × átlag(mg/dL)
    gmi: 3.31 + 0.02392 * avg * MGDL_PER_MMOL,
    pct,
  }
}
