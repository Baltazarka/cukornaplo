// Elemzés a mért adatokból: tiszta étkezések és tiszta korrekciók keresése, étkezés utáni
// görbék, és ezekből becslés a CH-arányra, az érzékenységi tényezőre (ISF) és az inzulin
// hatásidejére, napszakonként. Minden becslés javaslat: a terápia módosítása orvosi döntés.
import type { Therapy, TherapySegment } from '#shared/types/therapy'
import { db } from './db'
import { therapy, activeSegments, segmentAt, actionMinutesAt } from './therapy'
import { insulinKind, MEAL_WINDOW_SEC } from './insulinKind'
import { targetRange } from './range'

/** Ennyi tiszta esemény kell egy napszakban a becsléshez, illetve a megbízható becsléshez. */
export const MIN_EVENTS = 3
export const GOOD_EVENTS = 5

const STEP = 5 // perc
const MEAL_WINDOW_MIN = 240 // az étkezés utáni 4 óra
const MEAL_PRE_MIN = 30 // a görbe az étkezés előtt 30 perccel indul
const CORR_WINDOW_MIN = 360 // a korrekció utáni 6 óra
const MIN_COVERAGE = 0.7 // a vizsgált ablak legalább 70%-ában legyen szenzoradat
const MIN_DROP = 1 // mmol/L: ennél kisebb esésből nem becsülünk hatásidőt

interface G { ts: number; v: number }
interface Bolus { ts: number; v: number; kind: 'meal' | 'correction'; noCarbs: boolean }

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
function median(values: number[]): number | null {
  return values.length ? quantile([...values].sort((a, b) => a - b), 0.5) : null
}

/** Vércukor egy tetszőleges időpontban: lineáris közelítés két, legfeljebb 15 percre lévő mérés között. */
function sampler(g: G[]) {
  return (ts: number): number | null => {
    let lo = 0
    let hi = g.length - 1
    if (hi < 0 || ts < g[0].ts - 300 || ts > g[hi].ts + 300) return null
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (g[mid].ts <= ts) lo = mid
      else hi = mid - 1
    }
    const a = g[lo]
    const b = g[lo + 1]
    if (a.ts === ts) return a.v
    if (b && b.ts - a.ts <= 900 && a.ts <= ts) return a.v + ((b.v - a.v) * (ts - a.ts)) / (b.ts - a.ts)
    const near = [a, b].filter(Boolean).find((p) => Math.abs(p!.ts - ts) <= 300)
    return near ? near.v : null
  }
}

/** Görbe 5 percenként `fromMin`-től `toMin`-ig az időponthoz képest, és a lefedettsége. */
function curveAround(sample: (ts: number) => number | null, t0: number, fromMin: number, toMin: number) {
  const values: (number | null)[] = []
  for (let m = fromMin; m <= toMin; m += STEP) values.push(sample(t0 + m * 60))
  const covered = values.filter((v) => v != null).length / values.length
  return { values, covered }
}

/** Napszak-csoportok: a terápiás napszakok, vagy beállítás nélkül egyetlen „egész nap”. */
function segmentGroups(t: Therapy | null) {
  if (!t) return [{ index: 0, start: '00:00', end: '00:00', seg: null as TherapySegment | null }]
  const segs = activeSegments(t)
  return segs.map((s, i) => ({ index: i, start: s.start, end: segs[(i + 1) % segs.length].start, seg: s }))
}
function segIndexAt(t: Therapy | null, ts: number): number {
  if (!t || !t.byTimeOfDay) return 0
  return t.segments.indexOf(segmentAt(t, ts))
}

export interface MealEvent {
  ts: number
  seg: number
  carbs: number | null
  bolus: number
  preBolusMin: number | null
  startBG: number
  peak: number
  rise: number
  peakMin: number
  d2h: number | null
  d4h: number | null
  min: number
  rating: 'ok' | 'spike' | 'high' | 'low'
  correctionAfter: boolean
  clean: boolean
  /** Vércukor-eltérés a kezdőhöz képest, −30 … +240 perc, 5 percenként. */
  curve: (number | null)[]
}

export interface CorrectionEvent {
  ts: number
  seg: number
  dose: number
  startBG: number
  drop: number
  /** Megfigyelt érzékenység: legnagyobb esés ÷ egység (mmol/L/E). */
  isf: number
  /** Esés egységenként (mmol/L/E) 0 … 360 percig, 5 percenként. */
  perUnit: (number | null)[]
}

/**
 * Egy időszak elemzése (unix mp, [from, to)). Az ablakok miatt a széleken túli adatokat is betölti.
 */
export function analyze(from: number, to: number) {
  const t = therapy()
  const { low, high } = targetRange()
  const loadFrom = from - 8 * 3600
  const loadTo = to + 7 * 3600
  const rows = db()
    .prepare('SELECT type, ts, value, subtype FROM entries WHERE ts >= ? AND ts < ? ORDER BY ts')
    .all(loadFrom, loadTo) as { type: string; ts: number; value: number; subtype: string | null }[]

  const glucose: G[] = []
  const carbs: G[] = []
  const insulinRows: { ts: number; v: number; subtype: string | null }[] = []
  for (const r of rows) {
    const ts = Number(r.ts)
    const v = Number(r.value)
    if (r.type === 'glucose') glucose.push({ ts, v })
    else if (r.type === 'carbs') carbs.push({ ts, v })
    else insulinRows.push({ ts, v, subtype: r.subtype })
  }
  const carbTs = carbs.map((c) => c.ts)
  const boluses: Bolus[] = []
  for (const i of insulinRows) {
    const k = insulinKind(i.ts, i.subtype, carbTs)
    if (k.kind !== 'basal') boluses.push({ ts: i.ts, v: i.v, kind: k.kind, noCarbs: k.noCarbs })
  }
  const sample = sampler(glucose)
  const diaAt = (ts: number) => (t ? actionMinutesAt(t, ts) : 240)
  const targetAt = (ts: number) => (t ? segmentAt(t, ts).target : 6)

  // --- Étkezések: a 30 percen belüli CH-bejegyzések egy étkezés; a CH nélküli étkezési bólusok is.
  const groups: { ts: number; last: number; carbs: number | null; boluses: Bolus[] }[] = []
  for (const c of carbs) {
    const g = groups.at(-1)
    if (g && g.carbs != null && c.ts - g.last <= MEAL_WINDOW_SEC) {
      g.last = c.ts
      g.carbs += c.v
    } else groups.push({ ts: c.ts, last: c.ts, carbs: c.v, boluses: [] })
  }
  for (const b of boluses.filter((x) => x.kind === 'meal')) {
    const g = groups.find((x) => x.carbs != null && b.ts >= x.ts - MEAL_WINDOW_SEC && b.ts <= x.last + MEAL_WINDOW_SEC)
    if (g) g.boluses.push(b)
    else if (b.noCarbs) groups.push({ ts: b.ts, last: b.ts, carbs: null, boluses: [b] })
  }

  const meals: MealEvent[] = []
  for (const g of groups) {
    if (g.ts < from || g.ts >= to) continue
    const startBG = sample(g.ts)
    if (startBG == null) continue
    const { values, covered } = curveAround(sample, g.ts, -MEAL_PRE_MIN, MEAL_WINDOW_MIN)
    const after = values.slice(MEAL_PRE_MIN / STEP)
    if (after.filter((v) => v != null).length / after.length < MIN_COVERAGE || covered < MIN_COVERAGE) continue
    const own = new Set(g.boluses)
    const end = g.ts + MEAL_WINDOW_MIN * 60
    const firstBolus = g.boluses.length ? Math.min(...g.boluses.map((b) => b.ts)) : null
    const otherBolus = boluses.some((b) => !own.has(b) && b.ts >= g.ts - diaAt(g.ts) * 60 && b.ts <= end)
    const otherCarbs = carbs.some((c) => (c.ts < g.ts || c.ts > g.last) && c.ts >= g.ts - 2 * 3600 && c.ts <= end)
    const correctionAfter = boluses.some((b) => b.kind === 'correction' && b.ts > g.ts + MEAL_WINDOW_SEC && b.ts <= end)
    let peak = -Infinity
    let peakMin = 0
    let min = Infinity
    after.forEach((v, i) => {
      if (v == null) return
      if (v > peak) { peak = v; peakMin = i * STEP }
      if (v < min) min = v
    })
    const at = (m: number) => after[m / STEP] ?? null
    const d2h = at(120) != null ? at(120)! - startBG : null
    const d4h = at(240) != null ? at(240)! - startBG : null
    const rating: MealEvent['rating'] =
      min < low || (d4h != null && d4h < -2) ? 'low'
      : correctionAfter || (d4h != null && d4h > 2) ? 'high'
      : peak > high ? 'spike'
      : 'ok'
    meals.push({
      ts: g.ts,
      seg: segIndexAt(t, g.ts),
      carbs: g.carbs,
      bolus: r2(g.boluses.reduce((a, b) => a + b.v, 0)),
      preBolusMin: firstBolus != null ? Math.round((firstBolus - g.ts) / 60) : null,
      startBG: r1(startBG),
      peak: r1(peak),
      rise: r1(peak - startBG),
      peakMin,
      d2h: d2h != null ? r1(d2h) : null,
      d4h: d4h != null ? r1(d4h) : null,
      min: r1(min),
      rating,
      correctionAfter,
      clean: !otherBolus && !otherCarbs && !correctionAfter,
      curve: values.map((v) => (v == null ? null : r2(v - startBG))),
    })
  }

  // --- Tiszta korrekciók: étel és más bólus nélkül, a vércukor esése 6 órán át.
  const corrections: CorrectionEvent[] = []
  let correctionCount = 0
  for (const b of boluses) {
    if (b.kind !== 'correction' || b.ts < from || b.ts >= to) continue
    correctionCount++
    const end = b.ts + CORR_WINDOW_MIN * 60
    if (boluses.some((x) => x !== b && x.ts >= b.ts - diaAt(b.ts) * 60 && x.ts <= end)) continue
    if (carbs.some((c) => c.ts >= b.ts - 2 * 3600 && c.ts <= end)) continue
    const startBG = sample(b.ts)
    if (startBG == null) continue
    const { values, covered } = curveAround(sample, b.ts, 0, CORR_WINDOW_MIN)
    if (covered < MIN_COVERAGE) continue
    const drops = values.map((v) => (v == null ? null : startBG - v))
    const best = Math.max(...drops.map((d) => d ?? 0))
    if (best < MIN_DROP) continue
    corrections.push({
      ts: b.ts,
      seg: segIndexAt(t, b.ts),
      dose: b.v,
      startBG: r1(startBG),
      drop: r1(best),
      isf: r2(best / b.v),
      perUnit: drops.map((d) => (d == null ? null : r2(d / b.v))),
    })
  }

  // --- Napszakonkénti összesítés és becslés.
  const segments = segmentGroups(t).map((sg) => {
    const segMeals = meals.filter((m) => m.seg === sg.index)
    const cleanCarbMeals = segMeals.filter((m) => m.clean && m.carbs && m.bolus > 0 && m.d4h != null)
    const segCorr = corrections.filter((c) => c.seg === sg.index)

    // ISF és hatásidő: a tiszta korrekciók egységnyi esési görbéjére illesztett modellből.
    const actionFit = segCorr.length >= MIN_EVENTS ? fitAction(segCorr) : null

    // CH-arány: mennyi inzulin kellett volna, hogy 4 óra múlva a célértéken legyen?
    //   szükséges = beadott + (4 órás érték − cél) ÷ ISF;  ebből az étkezésre jutó rész a
    //   kezdő vércukor korrekciója nélkül; CH-arány = CH ÷ étkezésre jutó inzulin.
    const isfForIcr = sg.seg?.isf ?? null
    const icrValues: number[] = []
    if (isfForIcr) {
      for (const m of cleanCarbMeals) {
        const target = sg.seg!.target
        const end = m.startBG + m.d4h!
        const needed = m.bolus + (end - target) / isfForIcr
        const corr = Math.max(0, (m.startBG - target) / isfForIcr)
        const mealNeeded = needed - corr
        if (mealNeeded > 0.2) icrValues.push(m.carbs! / mealNeeded)
      }
    }
    const icrEst = icrValues.length >= MIN_EVENTS ? r1(median(icrValues)!) : null

    return {
      index: sg.index,
      start: sg.start,
      end: sg.end,
      therapy: sg.seg ? { target: sg.seg.target, isf: sg.seg.isf, icr: sg.seg.icr, actionMinutes: sg.seg.actionMinutes ?? t!.actionMinutes } : null,
      counts: {
        meals: segMeals.length,
        cleanMeals: cleanCarbMeals.length,
        cleanCorrections: segCorr.length,
      },
      meals: mealSummary(segMeals),
      estimate: {
        isf: actionFit ? { value: actionFit.isf, n: actionFit.n } : null,
        icr: icrEst != null ? { value: icrEst, n: icrValues.length } : null,
        action: actionFit,
      },
    }
  })

  return {
    therapySet: !!t,
    coverage: glucoseCoverage(glucose, from, Math.min(to, Math.floor(Date.now() / 1000))),
    counts: { meals: meals.length, corrections: correctionCount, cleanCorrections: corrections.length },
    segments,
    action: actionSummary(corrections, t),
  }
}

function glucoseCoverage(g: G[], from: number, to: number): number {
  if (to <= from) return 0
  const n = g.filter((p) => p.ts >= from && p.ts < to).length
  return Math.min(100, Math.round((100 * n) / ((to - from) / 300)))
}

/** Étkezések összesítése egy napszakra: medián görbe (eltérés a kezdőtől) és fő számok. */
function mealSummary(meals: MealEvent[]) {
  if (!meals.length) return null
  const minutes = meals[0].curve.map((_, i) => -MEAL_PRE_MIN + i * STEP)
  const band = (q: number) =>
    minutes.map((_, i) => {
      const vals = meals.map((m) => m.curve[i]).filter((v): v is number => v != null).sort((a, b) => a - b)
      return vals.length >= 2 ? r2(quantile(vals, q)) : null
    })
  const med = (pick: (m: MealEvent) => number | null) => {
    const v = median(meals.map(pick).filter((x): x is number => x != null))
    return v == null ? null : r1(v)
  }
  const ratings = { ok: 0, spike: 0, high: 0, low: 0 }
  for (const m of meals) ratings[m.rating]++
  return {
    n: meals.length,
    rise: med((m) => m.rise),
    peakMin: med((m) => m.peakMin),
    d2h: med((m) => m.d2h),
    d4h: med((m) => m.d4h),
    preBolus: med((m) => m.preBolusMin),
    ratings,
    curve: { minutes, p25: band(0.25), p50: band(0.5), p75: band(0.75) },
  }
}

/** Az egységnyi esési görbék mediánja 5 percenként. */
function medianCurve(events: CorrectionEvent[]): (number | null)[] {
  return events[0].perUnit.map((_, i) => median(events.map((e) => e.perUnit[i]).filter((x): x is number => x != null)))
}

/**
 * A mért esési görbékhez illesztett exponenciális modell rácskereséssel. Minden (csúcsidő,
 * hatásidő) párra a teljes esés nagysága (= ISF, mmol/L/E) zárt alakban adódik a legkisebb
 * négyzetek módszerével: medián esés(t) ≈ ISF × (1 − IOB(t)). A legkisebb eltérésű pár nyer.
 */
function fitAction(events: CorrectionEvent[]) {
  const med = medianCurve(events)
  let best: { peak: number; dia: number; isf: number; err: number } | null = null
  for (let dia = 120; dia <= 480; dia += 15) {
    for (let peak = 40; peak <= Math.min(120, dia * 0.4); peak += 5) {
      const m = insulinModel(peak, dia)
      const g = med.map((_, i) => 1 - m.iob(i * STEP))
      let og = 0
      let gg = 0
      med.forEach((o, i) => { if (o != null) { og += o * g[i]; gg += g[i] * g[i] } })
      if (gg === 0) continue
      const A = og / gg
      let err = 0
      let n = 0
      med.forEach((o, i) => { if (o != null) { err += (o - A * g[i]) ** 2; n++ } })
      const rmse = Math.sqrt(err / Math.max(1, n))
      if (A > 0 && (!best || rmse < best.err)) best = { peak, dia, isf: A, err: rmse }
    }
  }
  return best && { peak: best.peak, dia: best.dia, isf: r1(best.isf), rmse: r2(best.err), n: events.length }
}

/**
 * Az összes tiszta korrekció együtt: az esési görbék a teljes eséshez viszonyítva (0 → 1),
 * medián és sáv, mellette az illesztett és a jelenleg beállított modell.
 */
function actionSummary(events: CorrectionEvent[], t: Therapy | null) {
  const current = t ? { peak: insulinById(t.bolusInsulin)?.peakMinutes ?? 75, dia: t.actionMinutes } : null
  if (!events.length) return { n: 0, observed: null, fit: null, current }
  const fit = events.length >= MIN_EVENTS ? fitAction(events) : null
  // Viszonyítás: az illesztett teljes esés, vagy illesztés nélkül az események legnagyobb esése.
  const scale = (e: CorrectionEvent) => fit?.isf ?? e.isf
  const minutes = events[0].perUnit.map((_, i) => i * STEP)
  const band = (q: number) =>
    minutes.map((_, i) => {
      const v = events.map((e) => (e.perUnit[i] == null ? null : e.perUnit[i]! / scale(e)))
        .filter((x): x is number => x != null).sort((a, b) => a - b)
      return v.length ? r2(quantile(v, q)) : null
    })
  return {
    n: events.length,
    observed: { minutes, p25: band(0.25), p50: band(0.5), p75: band(0.75) },
    fit,
    current,
  }
}
