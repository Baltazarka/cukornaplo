// Vércukor-előrejelzés (hipó-előjelzéshez, grafikonhoz). Loop-szerű modell + xDrip+-szerű trendkeverés:
//  - aktív inzulin hatása (a bólusonkénti hatásmodellből, a beadás napszakának hatásidejével és
//    a pillanatnyi ISF-fel),
//  - fel nem szívódott szénhidrát hatása (felszívódási görbe, ISF ÷ CH-arány mmol/L / g),
//  - lendület (trend): a legutóbbi mérések meredeksége; rövid távon a trend, hosszabb távon a modell dönt
//    (súlyozott átlag, a trend súlya lépésenként gyorsan csökken, mint az xDrip+-ban).
//  A mode: 'blend' (alap) vagy 'residual' (a korábbi: a modellből nem magyarázható eltérés 15 percig folytatódik).
// Tájékoztató becslés, nem helyettesíti a CGM riasztásait.
import { db } from './db'
import { therapy, segmentAt } from './therapy'
import { rapidDoses, iobAt } from './iob'
import { targetRange } from './range'
import { glucosePoints, latestGlucose, type Latest } from './digest'
import { rateAt } from './trend'
import { absorbedFraction, absorbSpanMin, absorbCategory } from './absorption'

const MAX_AGE_SEC = 15 * 60 // ennél régebbi utolsó méréssel nem jósolunk
const MOMENTUM_MIN = 15
const TREND_WINDOW_SEC = 20 * 60 // a meredekséghez az utolsó 20 perc szenzormérései
const SLOPE_MAX = 0.2 // mmol/L/perc: ennél meredekebb trendet nem extrapolálunk
const BLEND_W0 = 0.1 // a modell súlya az első lépésnél (5 perc), lépésenként 2,5-szeresére nő
const BLEND_GROWTH = 2.5
const MAX_GLUCOSE = 30
export type PredictMode = 'blend' | 'residual'
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
  /** A legalacsonyabb becsült érték az előrejelzési távolságon belül. */
  nadir: number
  /** Hány perc múlva éri el a legalacsonyabb értéket. */
  nadirIn: number
  /** Hosszú távon kialakuló érték, ha nem történik semmi más (aktív inzulin és CH teljes hatásával). */
  eventual: number
  /** Javasolt gyors szénhidrát, g (hipó-veszélynél). */
  carbsNeeded: number | null
  /** Javasolt korrekciós inzulin, E (magas vércukornál, aktív inzulin levonva). */
  insulinNeeded: number | null
}

interface Model {
  latest: Latest
  low: number
  iob: number
  cob: number
  treated: boolean
  target: number
  high: number
  isf: number
  perG: number
  maxBolus: number
  eventual: number
  /** A becsült vércukor `h` perccel a `nowTs` után (mmol/L). */
  at: (h: number) => number
}

/** A becslés összetevői (adagok, szénhidrát, lendület) egyszer kiszámítva; `at(h)` bármely távolságra ad értéket. */
function build(nowTs: number, mode: PredictMode = 'blend'): Model | null {
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

  let insulinRate = 0
  for (const d of doses) insulinRate += d.v * d.model.activity((nowTs - d.ts) / 60) * seg.isf

  // Szénhidrát: a tiszta étkezésekből tanult felszívódási görbe (vagy az alapértelmezett ívelt).
  const meals = carbRows
    .map((c) => ({ grams: Number(c.value), ts: Number(c.ts), cat: absorbCategory(c.subtype) }))
    .filter((c) => (nowTs - c.ts) / 60 < absorbSpanMin(c.cat, c.grams))
  const absorbed = (c: { cat: ReturnType<typeof absorbCategory>; ts: number; grams: number }, h: number) => absorbedFraction(c.cat, (nowTs - c.ts) / 60 + h, c.grams)
  let carbRate = 0
  let cob = 0
  let treated = false
  for (const c of meals) {
    carbRate += (c.grams * (absorbed(c, 5) - absorbed(c, 0)) * perG) / 5
    cob += c.grams * (1 - absorbed(c, 0))
    if (nowTs - c.ts <= RECENT_TREAT_SEC && c.grams >= 10) treated = true
  }

  // Lendület: ami a modellből nem magyarázható, az még pár percig folytatódik.
  const pts = glucosePoints(nowTs - 40 * 60, nowTs + 60).filter((p) => !p.manual)
  const obsRate = pts.length ? rateAt(pts, pts.length - 1) : null
  const residual = obsRate == null ? 0 : Math.max(-0.15, Math.min(0.15, obsRate - (carbRate - insulinRate)))
  // Trend: legkisebb négyzetek szerinti meredekség az utolsó 20 percre (legalább 3 szenzormérés).
  const recent = pts.filter((p) => p.ts >= latest.ts - TREND_WINDOW_SEC && p.ts <= latest.ts)
  let slope: number | null = null
  if (recent.length >= 3) {
    const mx = recent.reduce((a, p) => a + p.ts, 0) / recent.length
    const my = recent.reduce((a, p) => a + p.v, 0) / recent.length
    const sxx = recent.reduce((a, p) => a + (p.ts - mx) ** 2, 0)
    if (sxx > 0) slope = Math.max(-SLOPE_MAX, Math.min(SLOPE_MAX, (recent.reduce((a, p) => a + (p.ts - mx) * (p.v - my), 0) / sxx) * 60))
  }

  const at = (h: number) => {
    let insulinEffect = 0
    for (const d of doses) {
      const m = (nowTs - d.ts) / 60
      insulinEffect += d.v * (d.model.iob(m) - d.model.iob(m + h)) * seg.isf
    }
    let carbEffect = 0
    for (const c of meals) carbEffect += c.grams * (absorbed(c, h) - absorbed(c, 0)) * perG
    const model = latest.v - insulinEffect + carbEffect
    let v: number
    if (mode === 'residual' || slope == null) {
      v = model + (mode === 'residual' ? residual * Math.min(h, MOMENTUM_MIN) : 0)
    } else {
      // Rövid távon a trend, hosszabb távon a modell: a modell súlya lépésenként (5 perc) 2,5-szeresére nő.
      const w = BLEND_W0 * BLEND_GROWTH ** (h / 5)
      v = (model * w + (latest.v + slope * h)) / (w + 1)
    }
    return Math.min(MAX_GLUCOSE, Math.max(1.5, v))
  }
  // Hosszú távú érték: a teljes még aktív inzulin és a még fel nem szívódó CH hatásával.
  let eventual = latest.v
  for (const d of doses) eventual -= d.v * d.model.iob((nowTs - d.ts) / 60) * seg.isf
  for (const c of meals) eventual += c.grams * (1 - absorbed(c, 0)) * perG
  const range = targetRange()
  return { latest, low: range.low, high: range.high, target: seg.target, isf: seg.isf, perG, maxBolus: t.maxBolus, eventual, iob: iobAt(doses, nowTs), cob, treated, at }
}

const round = (x: number, k: number) => Math.round(x * k) / k

const roundTo = (x: number, step: number) => Math.round(x / step) * step

/** A becsült vércukor `h` perccel `nowTs` után, az adott módszerrel (a pontosság visszatesztjéhez); a kiindulási érték is jár. */
export function predictValue(h: number, nowTs: number, mode: PredictMode): { latest: Latest; v: number } | null {
  const m = build(nowTs, mode)
  return m ? { latest: m.latest, v: m.at(h) } : null
}

export function predictGlucose(horizon = 30, nowTs = Math.floor(Date.now() / 1000)): Prediction | null {
  const m = build(nowTs)
  if (!m) return null
  const predicted = m.at(horizon)
  let nadir = m.latest.v
  let nadirIn = 0
  for (let h = 5; h <= horizon; h += 5) {
    const v = m.at(h)
    if (v < nadir) { nadir = v; nadirIn = h }
  }
  const currentLow = m.latest.v < m.low
  const risk = (nadir < m.low || currentLow) && !m.treated
  // Szénhidrát: annyi, hogy a mélypont a célértékre emelkedjen (5 g-ra kerekítve, 10–30 g között).
  const carbsNeeded = risk ? Math.min(30, Math.max(10, roundTo((m.target - nadir) / m.perG, 5))) : null
  // Inzulin: csak ha a vércukor most is és a hosszú távú értéke is a céltartomány fölött van, nincs hipó-veszély,
  // és nem esik gyorsan. A javaslat (hosszú távú érték − cél) ÷ ISF, 0,5 E-re kerekítve, a maximális bólusig.
  const fallingFast = (m.latest.rate ?? 0) <= -0.11
  let insulinNeeded: number | null = null
  if (!risk && !fallingFast && m.latest.v > m.high && m.eventual > m.high) {
    const dose = Math.min(m.maxBolus, roundTo((m.eventual - m.target) / m.isf, 0.5))
    if (dose >= 0.5) insulinNeeded = dose
  }
  return {
    now: m.latest,
    horizon,
    predicted: round(predicted, 10),
    currentLow,
    risk,
    low: m.low,
    iob: round(m.iob, 100),
    cob: Math.round(m.cob),
    treated: m.treated,
    nadir: round(nadir, 10),
    nadirIn,
    eventual: round(m.eventual, 10),
    carbsNeeded,
    insulinNeeded,
  }
}

/**
 * A várható vércukorgörbe a következő `hours` órára, 5 percenként: [időpont ms, mmol/L].
 * Csak a már felvett adagokból és szénhidrátból számol (a jövőbeli étkezést / adagot nem ismeri).
 */
export function predictSeries(hours = 3, nowTs = Math.floor(Date.now() / 1000)): [number, number][] {
  const m = build(nowTs)
  if (!m) return []
  const out: [number, number][] = [[nowTs * 1000, m.latest.v]]
  for (let h = 5; h <= hours * 60; h += 5) out.push([(nowTs + h * 60) * 1000, round(m.at(h), 10)])
  return out
}
