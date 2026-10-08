// Vércukor-változás sebessége és trendnyilak (mint a Guardian szenzornál):
// legalább 0,06 mmol/L/perc → 1 nyíl, 0,11 → 2 nyíl, 0,17 → 3 nyíl, felfelé vagy lefelé.

/** Küszöbök mmol/L / perc egységben: lassú, közepes, gyors változás. */
export const TREND_STEPS = [0.06, 0.11, 0.17] as const

export interface GPoint { ts: number; v: number }

/**
 * A változás sebessége az i. mérésnél (mmol/L / perc): a kb. 15 perccel korábbi méréshez képest
 * (10–20 perces ablakban a 15 perchez legközelebbi). Ha nincs ilyen mérés, null.
 */
export function rateAt(points: GPoint[], i: number): number | null {
  const cur = points[i]
  let best: GPoint | null = null
  for (let j = i - 1; j >= 0; j--) {
    const dt = (cur.ts - points[j].ts) / 60
    if (dt > 20) break
    if (dt >= 10 && (!best || Math.abs(dt - 15) < Math.abs((cur.ts - best.ts) / 60 - 15))) best = points[j]
  }
  return best ? (cur.v - best.v) / ((cur.ts - best.ts) / 60) : null
}

/** A sebesség nyílszáma: 0 (stabil) – 3 (gyors). */
export function trendLevel(rate: number): 0 | 1 | 2 | 3 {
  const a = Math.abs(rate)
  return a >= TREND_STEPS[2] ? 3 : a >= TREND_STEPS[1] ? 2 : a >= TREND_STEPS[0] ? 1 : 0
}

/** Az utolsó mérés trendje: irány (-1 / 0 / 1) és nyílszám. */
export function lastTrend(points: GPoint[]): { rate: number; dir: -1 | 0 | 1; level: 0 | 1 | 2 | 3 } | null {
  if (!points.length) return null
  const rate = rateAt(points, points.length - 1)
  if (rate == null) return null
  const level = trendLevel(rate)
  return { rate: Math.round(rate * 1000) / 1000, dir: level === 0 ? 0 : rate > 0 ? 1 : -1, level }
}

/**
 * A mért idő hány százalékában változott a vércukor az egyes sebességekkel. Minden két egymást
 * követő mérés közötti szakasz (legfeljebb 15 perces rés) a végpontja sebessége szerint számít.
 */
export function changeTime(points: GPoint[]): { slow: number; moderate: number; rapid: number; any: number } | null {
  const sum = [0, 0, 0, 0]
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].ts - points[i - 1].ts
    if (dt <= 0 || dt > 900) continue
    const rate = rateAt(points, i)
    if (rate == null) continue
    sum[trendLevel(rate)] += dt
    total += dt
  }
  if (!total) return null
  const pct = (s: number) => Math.round((1000 * s) / total) / 10
  return { slow: pct(sum[1]), moderate: pct(sum[2]), rapid: pct(sum[3]), any: pct(sum[1] + sum[2] + sum[3]) }
}
