// Vércukor-előrejelzés a következő 15–60 percre (hipó-előjelzéshez). Loop-szerű összetevők:
//  - aktív inzulin hatása (a bólusonkénti hatásmodellből, a beadás napszakának hatásidejével és
//    a pillanatnyi ISF-fel),
//  - fel nem szívódott szénhidrát hatása (lineáris felszívódás, ISF ÷ CH-arány mmol/L / g),
//  - lendület: a mért és a modell szerinti változás különbsége még rövid ideig (legfeljebb 15 perc) folytatódik.
// Tájékoztató becslés, nem helyettesíti a CGM riasztásait.
import { db } from './db'
import { therapy, segmentAt } from './therapy'
import { rapidDoses, iobAt } from './iob'
import { targetRange } from './range'
import { glucosePoints, latestGlucose, type Latest } from './digest'
import { rateAt } from './trend'

const MAX_AGE_SEC = 15 * 60 // ennél régebbi utolsó méréssel nem jósolunk
const ABSORB_MIN = { normal: 180, fatty: 240, fast: 90 } as const
const MOMENTUM_MIN = 15
const RECENT_TREAT_SEC = 20 * 60 // ennyivel előbb bevitt ≥ 10 g CH kezelésnek számít

export interface Prediction {
  now: Latest
  horizon: number
  predicted: number
  /** A jelenlegi érték a céltartomány alatt van. */
  currentLow: boolean
  /** Becsült érték a céltartomány alatt, vagy már most alatta, és nincs friss kezelés. */
  risk: boolean
  low: number
  /** Aktív inzulin, E. */
  iob: number
  /** Még fel nem szívódott szénhidrát, g. */
  cob: number
  treated: boolean
}

export function predictGlucose(horizon = 30, nowTs = Math.floor(Date.now() / 1000)): Prediction | null {
  const t = therapy()
  if (!t) return null
  const latest = latestGlucose(nowTs)
  if (!latest || nowTs - latest.ts > MAX_AGE_SEC) return null

  const seg = segmentAt(t, latest.ts)
  const perG = seg.isf / seg.icr // mmol/L / g szénhidrát
  const carbRows = db()
    .prepare("SELECT ts, value, subtype FROM entries WHERE type = 'carbs' AND ts >= ? AND ts <= ? ORDER BY ts")
    .all(nowTs - 6 * 3600, nowTs) as { ts: number; value: number; subtype: string | null }[]
  const doses = rapidDoses(t, nowTs, nowTs + 1, carbRows.map((c) => Number(c.ts)))

  let insulinEffect = 0
  let insulinRate = 0
  for (const d of doses) {
    const m = (nowTs - d.ts) / 60
    insulinEffect += d.v * (d.model.iob(m) - d.model.iob(m + horizon)) * seg.isf
    insulinRate += d.v * d.model.activity(m) * seg.isf
  }

  let carbEffect = 0
  let carbRate = 0
  let cob = 0
  let treated = false
  for (const c of carbRows) {
    const grams = Number(c.value)
    const dur = c.subtype === 'fatty' ? ABSORB_MIN.fatty : c.subtype === 'fast' ? ABSORB_MIN.fast : ABSORB_MIN.normal
    const m = (nowTs - Number(c.ts)) / 60
    if (m >= dur) continue
    const a = Math.max(0, m) / dur
    const b = Math.min(1, (m + horizon) / dur)
    carbEffect += grams * (b - a) * perG
    carbRate += (grams / dur) * perG
    cob += grams * (1 - a)
    if (nowTs - Number(c.ts) <= RECENT_TREAT_SEC && grams >= 10) treated = true
  }

  // Lendület: ami a modellből nem magyarázható, az még pár percig folytatódik.
  const pts = glucosePoints(nowTs - 40 * 60, nowTs + 60)
  const obsRate = pts.length ? rateAt(pts, pts.length - 1) : null
  const residual = obsRate == null ? 0 : Math.max(-0.15, Math.min(0.15, obsRate - (carbRate - insulinRate)))
  const momentum = residual * Math.min(horizon, MOMENTUM_MIN)

  const predicted = Math.max(1.5, latest.v - insulinEffect + carbEffect + momentum)
  const { low } = targetRange()
  const currentLow = latest.v < low
  const round = (x: number, k: number) => Math.round(x * k) / k
  return {
    now: latest,
    horizon,
    predicted: round(predicted, 10),
    currentLow,
    risk: (predicted < low || currentLow) && !treated,
    low,
    iob: round(iobAt(doses, nowTs), 100),
    cob: Math.round(cob),
    treated,
  }
}
