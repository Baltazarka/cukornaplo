// Vércukor-előrejelzés (hipó-előjelzéshez, grafikonhoz). Loop-szerű modell + xDrip+-szerű trendkeverés:
//  - aktív inzulin hatása (a bólusonkénti hatásmodellből, a beadás napszakának hatásidejével és
//    a beadás napszakának ISF-jével),
//  - fel nem szívódott szénhidrát hatása (felszívódási görbe, az étkezés napszakának ISF ÷ CH-aránya mmol/L / g),
//  - lendület (trend): a legutóbbi mérések meredeksége; rövid távon a trend, hosszabb távon a modell dönt
//    (súlyozott átlag, a trend súlya lépésenként gyorsan csökken, mint az xDrip+-ban).
//  Módszerek: 'persist' (az utolsó érték marad), 'trend' (csillapított lineáris extrapoláció: fél meredekség, legfeljebb 15 percre),
//  'residual' (a modellből nem magyarázható eltérés 15 percig folytatódik), 'blend' (trend + modell keverése).
//  Alapból az automatikus választás él: a Terápia oldali visszateszt alapján távolságonként (15 / 30 / 60 perc) és
//  aszerint, hogy van-e aktív inzulin / szénhidrát, a legkisebb hibájú módszer, így a bonyolultabb modell csak akkor
//  számít, ha a saját adataidon tényleg pontosabb az egyszerűnél.
// A tiszta számolás (adagok, szénhidrát, trend → becslés): predictCore.ts (tesztelt: tests/predict.test.ts); ez a fájl az adatokat gyűjti és a módszert választja.
// Tájékoztató becslés, nem helyettesíti a CGM riasztásait.
import { db } from './db'
import { therapy, segmentAt, blendAt } from './therapy'
import { rapidDoses } from './iob'
import { targetRange } from './range'
import { glucosePoints, latestGlucose, type Latest } from './digest'
import { rateAt } from './trend'
import { absorbedFraction, absorbSpanMin, absorbCategory } from './absorption'
import { readComputed } from './computed'
import { suggestInsulin } from '#shared/utils/suggest'
import { forecast, MAX_GLUCOSE, type PredictMode } from './predictCore'

const MAX_AGE_SEC = 15 * 60 // ennél régebbi utolsó méréssel nem jósolunk
export type { PredictMode }
export const PREDICT_MODES: PredictMode[] = ['persist', 'trend', 'residual', 'blend']
/** A kiválasztott módszer távolságonként és állapotonként (aktív inzulin / CH van-e). */
export type PredictChoice = Record<'15' | '30' | '60', { active: PredictMode; calm: PredictMode }>
export const CHOICE_KEY = 'predict-choice'
/** A keverés (modell) átlagos eltérése a visszatesztből (becsült − mért, mmol/L), távolságonként és állapotonként. */
export type PredictBias = Record<'15' | '30' | '60', { active: number | null; calm: number | null }>
export const BIAS_KEY = 'predict-bias'
const BIAS_MAX = 2 // mmol/L: ennél nagyobb korrekciót nem alkalmazunk
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
let biasCache: { at: number; v: PredictBias | null } | null = null
function biasTable(): PredictBias | null {
  const now = Date.now()
  if (biasCache && now - biasCache.at < 600_000) return biasCache.v
  biasCache = { at: now, v: readComputed<PredictBias>(BIAS_KEY)?.data ?? null }
  return biasCache.v
}
export function resetPredictChoice(): void {
  choiceCache = null
  biasCache = null
}
/**
 * A keverés torzítása `h` percre: a 15 / 30 / 60 perces mért értékek között lineárisan (0-tól), 60 perc után arányosan
 * nő, legfeljebb BIAS_MAX. A valós adatban aktív inzulinnál a modell rendszeresen túl nagy esést jósolt (téves hipó-jelzés).
 */
function biasAt(h: number, active: boolean): number {
  const b = biasTable()
  if (!b) return 0
  const pts: [number, number][] = [[0, 0]]
  for (const k of ['15', '30', '60'] as const) {
    const v = active ? b[k]?.active : b[k]?.calm
    if (v != null) pts.push([Number(k), v])
  }
  if (pts.length < 2) return 0
  let v: number
  const last = pts[pts.length - 1]
  if (h >= last[0]) v = (last[1] * h) / last[0]
  else {
    let i = 1
    while (pts[i][0] < h) i++
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    v = y0 + ((y1 - y0) * (h - x0)) / (x1 - x0)
  }
  return Math.max(-BIAS_MAX, Math.min(BIAS_MAX, v))
}
/** A távolsághoz legközelebbi tesztelt távolság (15 / 30 / 60 perc). */
const bucket = (h: number): '15' | '30' | '60' => (h <= 22 ? '15' : h <= 45 ? '30' : '60')

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
  /** Javasolt korrekciós inzulin, E (magas vércukornál, aktív inzulin levonva): a teljes szükséglet fele, a toll lépésére lefelé kerekítve. */
  insulinNeeded: number | null
  /** A teljes szükséglet, E (a javaslat ennek egy lépése, egy óra múlva újraszámol). */
  insulinFull: number | null
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
  /** A keverés a visszatesztben mért átlagos eltéréssel korrigálva (hipó-mélyponthoz, grafikonhoz). */
  blendCorrected: (h: number) => number
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
  // Minden adag / étkezés a beadás (étkezés) idejének ISF-jével és CH-arányával hat, nem a mostanival (ahogy a Loop is
  // teszi): napszakhatáron így nem ugrik a becslés. A napszakok közti átmenettel (blendAt), ahogy a bóluskalkulátor
  // is számol: az adag mennyiségét az átmeneti ISF-fel döntötted el, a hatását ugyanezzel kell becsülni.
  const isfAt = (ts: number) => blendAt(t, ts)?.isf ?? segmentAt(t, ts).isf
  const perGAt = (ts: number) => {
    const b = blendAt(t, ts)
    if (b) return b.isf / b.icr
    const s2 = segmentAt(t, ts)
    return s2.isf / s2.icr
  }
  const perG = perGAt(latest.ts) // mmol/L / g szénhidrát a mostani időpontban: a javaslatokhoz
  const carbRows = db()
    .prepare("SELECT ts, value, subtype FROM entries WHERE type = 'carbs' AND ts >= ? AND ts <= ? ORDER BY ts")
    .all(nowTs - 12 * 3600, nowTs) as { ts: number; value: number; subtype: string | null }[] // a tanult felszívódás nagy étkezésnél 12 óráig is tarthat
  const doses = rapidDoses(t, nowTs, nowTs + 1, carbRows.map((c) => Number(c.ts)))

  // Szénhidrát: a tiszta étkezésekből tanult felszívódási görbe (vagy az alapértelmezett ívelt).
  const meals = carbRows
    .map((c) => ({ grams: Number(c.value), ts: Number(c.ts), cat: absorbCategory(c.subtype), perG: perGAt(Number(c.ts)) }))
    .filter((c) => (nowTs - c.ts) / 60 < absorbSpanMin(c.cat, c.grams))
  const pts = glucosePoints(nowTs - 40 * 60, nowTs + 60).filter((p) => !p.manual)
  const obsRate = pts.length ? rateAt(pts, pts.length - 1) : null
  const { atMode, eventual, iob: iobNow, cob, treated, lastBolusTs } = forecast({
    nowTs, latest, doses, meals, absorbedFrac: absorbedFraction, pts, obsRate, isfAt,
  })
  const active = iobNow >= ACTIVE_IOB || cob >= ACTIVE_COB
  const blendCorrected = (h: number) => Math.min(MAX_GLUCOSE, Math.max(1.5, atMode(h, 'blend') - biasAt(h, active)))
  const at = (h: number) => {
    if (mode !== 'auto') return atMode(h, mode)
    const c = choice()?.[bucket(h)]
    const md = c ? (active ? c.active : c.calm) : 'trend'
    return md === 'blend' ? blendCorrected(h) : atMode(h, md)
  }
  const range = targetRange()
  return { latest, low: range.low, high: range.high, target: seg.target, isf: seg.isf, perG, maxBolus: t.maxBolus, eventual, iob: iobNow, cob, treated, active, at, atMode, blendCorrected, lastBolusTs }
}

const round = (x: number, k: number) => Math.round(x * k) / k

const roundTo = (x: number, step: number) => Math.round(x / step) * step

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
    // modellje (keverés) közül a legkisebbet vesszük, hogy az aktív inzulin lefelé mutató hatása ne vesszen el; a
    // keverést a saját adataidon mért torzításával korrigálva (különben aktív inzulinnál téves riasztás lenne).
    const v = Math.min(m.at(h), m.atMode(h, 'trend'), m.blendCorrected(h))
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
  // A teljes szükséglet (hosszú távú érték − cél) ÷ ISF (a kalkulátorhoz hasonlóan a napszakok közti átmenettel); a javaslat
  // ennek fele, a toll lépésére (alap 1 E) lefelé kerekítve, a maximális bólusig (shared/utils/suggest.ts).
  const falling = m.latest.rate == null || m.latest.rate <= -0.03
  const recentBolus = m.lastBolusTs > 0 && nowTs - m.lastBolusTs < SUGGEST_AFTER_BOLUS_MIN * 60
  let insulinNeeded: number | null = null
  let insulinFull: number | null = null
  if (!risk && !falling && !recentBolus && m.iob < SUGGEST_MAX_IOB && m.latest.v > m.high && m.eventual > m.high) {
    const t = therapy()
    const isf = (t && blendAt(t, nowTs)?.isf) || m.isf
    const step = setting<{ doseStep?: number }>('notify', null)?.doseStep === 0.5 ? 0.5 : 1
    const s = suggestInsulin({ eventual: m.eventual, target: m.target, isf, maxBolus: m.maxBolus, step })
    if (s) { insulinNeeded = s.units; insulinFull = s.full }
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
    insulinFull,
  }
}

/**
 * A várható vércukorgörbe a következő `hours` órára, 5 percenként: [időpont ms, mmol/L].
 * Mindig az inzulin / szénhidrát modelljét (keverés, a visszatesztben mért torzítással korrigálva) mutatja: azt, hogy a már felvett adagokkal és szénhidráttal mi
 * várható, ha nem történik más (a jövőbeli étkezést / adagot nem ismeri). Az automatikusan választott módszer a
 * pontszerű előrejelzésre (és a hipó-jelzésre) vonatkozik, nem a görbére: a vízszintes „változatlan" vonal aktív
 * inzulin mellett félrevezető lenne.
 */
export function predictSeries(hours = 3, nowTs = Math.floor(Date.now() / 1000)): [number, number][] {
  const m = build(nowTs)
  if (!m) return []
  const out: [number, number][] = [[nowTs * 1000, m.latest.v]]
  for (let h = 5; h <= hours * 60; h += 5) out.push([(nowTs + h * 60) * 1000, round(m.blendCorrected(h), 10)])
  return out
}
