// Vércukor-előrejelzés (hipó-előjelzéshez, grafikonhoz). Loop-szerű modell + xDrip+-szerű trendkeverés:
//  - aktív inzulin hatása (a bólusonkénti hatásmodellből, a beadás napszakának hatásidejével és
//    a beadás napszakának ISF-jével),
//  - fel nem szívódott szénhidrát hatása (felszívódási görbe, az étkezés napszakának ISF ÷ CH-aránya mmol/L / g),
//  - lendület (trend): a legutóbbi mérések meredeksége; rövid távon a trend, hosszabb távon a modell dönt
//    (súlyozott átlag, a trend súlya lépésenként gyorsan csökken, mint az xDrip+-ban).
//  Módszerek: 'persist' (az utolsó érték marad), 'trend' (csillapított lineáris extrapoláció, legfeljebb 20 percre),
//  'residual' (a modellből nem magyarázható eltérés 15 percig folytatódik), 'blend' (trend + modell keverése).
//  Alapból az automatikus választás él: a Terápia oldali visszateszt alapján távolságonként (15 / 30 / 60 perc) és
//  aszerint, hogy van-e aktív inzulin / szénhidrát, a legkisebb hibájú módszer, így a bonyolultabb modell csak akkor
//  számít, ha a saját adataidon tényleg pontosabb az egyszerűnél.
// Tájékoztató becslés, nem helyettesíti a CGM riasztásait.
import { db } from './db'
import { therapy, segmentAt, blendAt } from './therapy'
import { rapidDoses, iobAt } from './iob'
import { targetRange } from './range'
import { glucosePoints, latestGlucose, type Latest } from './digest'
import { rateAt } from './trend'
import { absorbedFraction, absorbSpanMin, absorbCategory } from './absorption'
import { readComputed } from './computed'

const MAX_AGE_SEC = 15 * 60 // ennél régebbi utolsó méréssel nem jósolunk
const MOMENTUM_MIN = 15
const TREND_WINDOW_SEC = 20 * 60 // a meredekséghez az utolsó 20 perc szenzormérései
const SLOPE_MAX = 0.2 // mmol/L/perc: ennél meredekebb trendet nem extrapolálunk
const BLEND_W0 = 0.1 // a modell súlya az első lépésnél (5 perc), lépésenként 2,5-szeresére nő
const BLEND_GROWTH = 2.5
const MAX_GLUCOSE = 30
export type PredictMode = 'persist' | 'trend' | 'residual' | 'blend'
export const PREDICT_MODES: PredictMode[] = ['persist', 'trend', 'residual', 'blend']
/** A kiválasztott módszer távolságonként és állapotonként (aktív inzulin / CH van-e). */
export type PredictChoice = Record<'15' | '30' | '60', { active: PredictMode; calm: PredictMode }>
export const CHOICE_KEY = 'predict-choice'
const TREND_CAP_MIN = 20 // a csillapított trend legfeljebb ennyi percig folytatódik
const ACTIVE_IOB = 0.5 // E
const ACTIVE_COB = 10 // g
/** Inzulinjavaslat csak ennél kevesebb aktív inzulinnál (E) … */
const SUGGEST_MAX_IOB = 3
/** … és ha az utolsó bólus óta legalább ennyi perc eltelt (a frissen beadott adag még nem hatott: halmozás ellen). */
const SUGGEST_AFTER_BOLUS_MIN = 60

let choiceCache: { at: number; v: PredictChoice | null } | null = null
function choice(): PredictChoice | null {
  const now = Date.now()
  if (choiceCache && now - choiceCache.at < 600_000) return choiceCache.v
  choiceCache = { at: now, v: readComputed<PredictChoice>(CHOICE_KEY)?.data ?? null }
  return choiceCache.v
}
export function resetPredictChoice(): void {
  choiceCache = null
}
/** A távolsághoz legközelebbi tesztelt távolság (15 / 30 / 60 perc). */
const bucket = (h: number): '15' | '30' | '60' => (h <= 22 ? '15' : h <= 45 ? '30' : '60')
const RECENT_TREAT_SEC = 30 * 60 // ennyivel előbb bevitt ≥ 10 g CH kezelésnek számít (közben nincs hipó-értesítés)

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
  /** Van aktív inzulin vagy szénhidrát. */
  active: boolean
  /** A becsült vércukor `h` perccel a `nowTs` után (mmol/L), az automatikusan választott módszerrel. */
  at: (h: number) => number
  /** Ugyanez egy adott módszerrel. */
  atMode: (h: number, mode: PredictMode) => number
  /** A legutóbbi (nem bázis) bólus időpontja, 0 ha nincs. */
  lastBolusTs: number
}

/** A becslés összetevői (adagok, szénhidrát, lendület) egyszer kiszámítva; `at(h)` bármely távolságra ad értéket. */
function build(nowTs: number, mode: PredictMode | 'auto' = 'auto'): Model | null {
  const t = therapy()
  if (!t) return null
  const latest = latestGlucose(nowTs)
  if (!latest || nowTs - latest.ts > MAX_AGE_SEC) return null

  const seg = segmentAt(t, latest.ts)
  const perG = seg.isf / seg.icr // mmol/L / g szénhidrát (a mostani napszakban: a javaslatokhoz)
  // Minden adag / étkezés a beadás (étkezés) napszakának ISF-jével és CH-arányával hat, nem a mostanival
  // (ahogy a Loop is teszi): napszakhatáron így nem ugrik a becslés.
  const isfAt = (ts: number) => segmentAt(t, ts).isf
  const perGAt = (ts: number) => {
    const s2 = segmentAt(t, ts)
    return s2.isf / s2.icr
  }
  const carbRows = db()
    .prepare("SELECT ts, value, subtype FROM entries WHERE type = 'carbs' AND ts >= ? AND ts <= ? ORDER BY ts")
    .all(nowTs - 8 * 3600, nowTs) as { ts: number; value: number; subtype: string | null }[]
  const doses = rapidDoses(t, nowTs, nowTs + 1, carbRows.map((c) => Number(c.ts)))

  let insulinRate = 0
  for (const d of doses) insulinRate += d.v * d.model.activity((nowTs - d.ts) / 60) * isfAt(d.ts)

  // Szénhidrát: a tiszta étkezésekből tanult felszívódási görbe (vagy az alapértelmezett ívelt).
  const meals = carbRows
    .map((c) => ({ grams: Number(c.value), ts: Number(c.ts), cat: absorbCategory(c.subtype), perG: perGAt(Number(c.ts)) }))
    .filter((c) => (nowTs - c.ts) / 60 < absorbSpanMin(c.cat, c.grams))
  const absorbed = (c: { cat: ReturnType<typeof absorbCategory>; ts: number; grams: number }, h: number) => absorbedFraction(c.cat, (nowTs - c.ts) / 60 + h, c.grams)
  let carbRate = 0
  let cob = 0
  let treated = false
  for (const c of meals) {
    carbRate += (c.grams * (absorbed(c, 5) - absorbed(c, 0)) * c.perG) / 5
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

  // Az utolsó mérés kora: a becslés a mérés időpontjától számol (a mérés és a „most” közötti inzulin- és CH-hatás
  // sem maradhat ki: 8 E aktív inzulinnál 10 perc késés ~0,5 mmol/L).
  const lagMin = Math.max(0, (nowTs - latest.ts) / 60)
  const atMode = (h: number, md: PredictMode) => {
    const hh = h + lagMin // a mérés óta eltelt perc a célidőpontig
    if (md === 'persist' || (md === 'trend' && slope == null)) return Math.min(MAX_GLUCOSE, Math.max(1.5, latest.v))
    if (md === 'trend') return Math.min(MAX_GLUCOSE, Math.max(1.5, latest.v + slope! * Math.min(hh, TREND_CAP_MIN)))
    let insulinEffect = 0
    for (const d of doses) {
      const m = (nowTs - d.ts) / 60
      insulinEffect += d.v * (d.model.iob(m - lagMin) - d.model.iob(m + h)) * isfAt(d.ts)
    }
    let carbEffect = 0
    for (const c of meals) carbEffect += c.grams * (absorbed(c, h) - absorbed(c, -lagMin)) * c.perG
    const model = latest.v - insulinEffect + carbEffect
    let v: number
    if (md === 'residual' || slope == null) {
      v = model + (md === 'residual' ? residual * Math.min(hh, MOMENTUM_MIN) : 0)
    } else {
      // Rövid távon a trend, hosszabb távon a modell: a modell súlya lépésenként (5 perc) 2,5-szeresére nő.
      const w = BLEND_W0 * BLEND_GROWTH ** (hh / 5)
      v = (model * w + (latest.v + slope * hh)) / (w + 1)
    }
    return Math.min(MAX_GLUCOSE, Math.max(1.5, v))
  }
  const iobNow = iobAt(doses, nowTs)
  const lastBolusTs = doses.reduce((a, d) => (d.ts <= nowTs && d.ts > a ? d.ts : a), 0)
  const active = iobNow >= ACTIVE_IOB || cob >= ACTIVE_COB
  const at = (h: number) => {
    if (mode !== 'auto') return atMode(h, mode)
    const c = choice()?.[bucket(h)]
    return atMode(h, c ? (active ? c.active : c.calm) : 'trend')
  }
  // Hosszú távú érték: a teljes még aktív inzulin és a még fel nem szívódó CH hatásával.
  let eventual = latest.v
  // (a mérés időpontjától: ami a mérés óta már hatott, az még nincs benne a mért értékben)
  for (const d of doses) eventual -= d.v * d.model.iob((latest.ts - d.ts) / 60) * isfAt(d.ts)
  for (const c of meals) eventual += c.grams * (1 - absorbed(c, -lagMin)) * c.perG
  const range = targetRange()
  return { latest, low: range.low, high: range.high, target: seg.target, isf: seg.isf, perG, maxBolus: t.maxBolus, eventual, iob: iobNow, cob, treated, active, at, atMode, lastBolusTs }
}

const round = (x: number, k: number) => Math.round(x * k) / k

const roundTo = (x: number, step: number) => Math.round(x / step) * step
const floorTo = (x: number, step: number) => Math.floor(x / step + 1e-9) * step

/**
 * A pontosság visszatesztjéhez: egyszer felépített modellből az összes kért módszer és távolság becslése.
 * `active`: volt-e aktív inzulin / szénhidrát az időpontban.
 */
export function predictMany(nowTs: number, horizons: number[], modes: PredictMode[]): { latest: Latest; active: boolean; v: Record<string, Record<number, number>> } | null {
  const m = build(nowTs, 'blend')
  if (!m) return null
  const v: Record<string, Record<number, number>> = {}
  for (const md of modes) {
    v[md] = {}
    for (const h of horizons) v[md][h] = m.atMode(h, md)
  }
  return { latest: m.latest, active: m.active, v }
}

export function predictGlucose(horizon = 30, nowTs = Math.floor(Date.now() / 1000)): Prediction | null {
  const m = build(nowTs)
  if (!m) return null
  const predicted = m.at(horizon)
  let nadir = m.latest.v
  let nadirIn = 0
  for (let h = 5; h <= horizon; h += 5) {
    // A hipó-veszély felmérésében óvatosan: a választott módszer, a csillapított trend és az inzulin / szénhidrát
    // modellje (keverés) közül a legkisebbet vesszük, hogy az aktív inzulin lefelé mutató hatása ne vesszen el.
    const v = Math.min(m.at(h), m.atMode(h, 'trend'), m.atMode(h, 'blend'))
    if (v < nadir) { nadir = v; nadirIn = h }
  }
  const currentLow = m.latest.v < m.low
  const risk = (nadir < m.low || currentLow) && !m.treated
  // Szénhidrát: annyi, hogy a mélypont a célértékre emelkedjen (5 g-ra kerekítve, 10–30 g között).
  // A mélypontot a távon belüli legkisebb és a hosszú távú érték közül a kisebb adja: nagy aktív inzulinnál a mélypont
  // az előrejelzési távon túl is lehet (a javaslat így nem alulbecsül; 30 g-nál nem több).
  const lowest = Math.min(nadir, m.eventual)
  const carbsNeeded = risk ? Math.min(30, Math.max(10, roundTo((m.target - lowest) / m.perG, 5))) : null
  // Inzulin: csak ha a vércukor most is és a hosszú távú értéke is a céltartomány fölött van, nincs hipó-veszély,
  // nem esik, kevés az aktív inzulin, és az utolsó bólus óta legalább egy óra eltelt (a valós adatban a frissen
  // beadott adag melletti javaslatok halmozódtak). Ismeretlen trendnél (kevés friss szenzoradat) nincs javaslat.
  // A javaslat (hosszú távú érték − cél) ÷ ISF (a kalkulátorhoz hasonlóan a napszakok közti átmenettel), 0,5 E-re
  // lefelé kerekítve, a (lefelé kerekített) maximális bólusig.
  const falling = m.latest.rate == null || m.latest.rate <= -0.03
  const recentBolus = m.lastBolusTs > 0 && nowTs - m.lastBolusTs < SUGGEST_AFTER_BOLUS_MIN * 60
  let insulinNeeded: number | null = null
  if (!risk && !falling && !recentBolus && m.iob < SUGGEST_MAX_IOB && m.latest.v > m.high && m.eventual > m.high) {
    const t = therapy()
    const isf = (t && blendAt(t, nowTs)?.isf) || m.isf
    const dose = Math.min(floorTo(m.maxBolus, 0.5), floorTo((m.eventual - m.target) / isf, 0.5))
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
 * Mindig az inzulin / szénhidrát modelljét (keverés) mutatja: azt, hogy a már felvett adagokkal és szénhidráttal mi
 * várható, ha nem történik más (a jövőbeli étkezést / adagot nem ismeri). Az automatikusan választott módszer a
 * pontszerű előrejelzésre (és a hipó-jelzésre) vonatkozik, nem a görbére: a vízszintes „változatlan" vonal aktív
 * inzulin mellett félrevezető lenne.
 */
export function predictSeries(hours = 3, nowTs = Math.floor(Date.now() / 1000)): [number, number][] {
  const m = build(nowTs)
  if (!m) return []
  const out: [number, number][] = [[nowTs * 1000, m.latest.v]]
  for (let h = 5; h <= hours * 60; h += 5) out.push([(nowTs + h * 60) * 1000, round(m.atMode(h, 'blend'), 10)])
  return out
}
