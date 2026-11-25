// Elemzés a mért adatokból: tiszta étkezések és tiszta korrekciók keresése, étkezés utáni
// görbék, és ezekből becslés a CH-arányra, az érzékenységi tényezőre (ISF) és az inzulin
// hatásidejére, napszakonként. Minden becslés javaslat: a terápia módosítása orvosi döntés.
import type { Therapy, TherapySegment } from '#shared/types/therapy'
import { db } from './db'
import { therapy, therapyAt, activeSegments, segmentAt, actionMinutesAt, hmToMin, profileOn } from './therapy'
import { insulinKind, MEAL_WINDOW_SEC, PREBOLUS_SEC } from './insulinKind'
import { notesBetween } from './notes'
import { targetRange } from './range'
import { minuteOfDayInTz, ymdInTz } from './time'
import { defaultTotalMin, scaleFor, absorbedFraction } from './absorption'
import { fpuUnits, fpuHours, FPU_CARB_G } from '#shared/utils/fpu'
import { MIN_EVENTS, STEP, quantile, median, weightedMedian, isotonic, fitAction, nadirDrop } from './analysisMath'

export { MIN_EVENTS }

/** Ennyi tiszta esemény kell egy napszakban a becsléshez, illetve a megbízható becsléshez. */
export const GOOD_EVENTS = 5
/** A saját zsír-fehérje % becsléséhez ennyi kiértékelhető zsíros étkezés kell a megbízhatóhoz. */
export const FPU_GOOD_EVENTS = 6
/** A zsír-fehérje % becslés csak akkor „megbízható”, ha az étkezések középső fele ennél kisebb sávban van (%-pont). */
const FPU_MAX_IQR = 60

const MEAL_WINDOW_MIN = 240 // az étkezés utáni 4 óra
const FATTY_WINDOW_MIN = 360 // zsíros / fehérjedús étkezésnél 6 óra (később emel)
const FAST_WINDOW_MIN = 120 // gyors CH (pl. hipó kezelése): 2 óra alatt felszívódik
const MEAL_PRE_MIN = 30 // a görbe az étkezés előtt 30 perccel indul
const CORR_WINDOW_MIN = 360 // a korrekció utáni görbe legfeljebb 6 óráig tart
const CORR_PRE_MIN = 60 // tiszta korrekció: előtte 1 óráig nincs étel és más bólus
const MIN_COVERAGE = 0.7 // a vizsgált ablak legalább 70%-ában legyen szenzoradat
const MIN_DROP = 1 // mmol/L: ennél kisebb esésből nem becsülünk hatásidőt (felső korlát, ha nincs terápia)
/**
 * A kis adag kicsit esik: a szükséges esés az adaggal és a beállított ISF-fel arányos (a várható esés negyede),
 * legalább 0,3 mmol/L, de legfeljebb MIN_DROP. Pl. 4 E × ISF 0,5 = 2 mmol/L várható → 0,5 mmol/L elég.
 */
const MIN_DROP_FRAC = 0.25
const MIN_DROP_FLOOR = 0.3
const CLEAN_PRE_MIN = 60 // tiszta étkezés: az étkezés / saját bólus előtt 1 óráig nincs más bólus
const STEEP_RATE = 0.11 // mmol/L/perc (2 nyíl): ilyen gyorsan változó kezdő vércukornál nem tiszta az étkezés
/** Tiszta korrekció: a korábbi bólusok még ható maradéka legfeljebb ennyi E, de legalább a korrekció ennyi hányada. */
const CORR_LEFTOVER_MIN_E = 0.25
const CORR_LEFTOVER_FRAC = 0.15
/** A CH-arány megbízhatatlan, ha a medián görbe a végpont előtti 30 percben ennyi mmol/L-nél többet még emelkedik. */
const ICR_RISING = 0.6
/**
 * Rövidített ablak: ha a tiszta étkezést legalább ennyi perc után zavarja meg valami (korrekció, ráevés, hipó
 * kezelése, zavaró jegyzet), az étkezés a zavarásig számít a CH-arány becslésében. Rövidebb ablakból nem becsülünk.
 */
const TRUNC_MIN = 180
/** Egymás utáni korrekciók összevonása: a következő korrekció legfeljebb ennyivel az előző után jöhet. */
const CHAIN_GAP_SEC = 3 * 3600
/** Érzékenység minden adatból: legalább ennyi 5 perces lépés (3 óra) kell, legalább 3 különböző napról. */
const ALL_ISF_MIN_STEPS = 36
/** Ennyi inzulinnak (E) kell hatnia 5 perc alatt, hogy a lépés számítson (különben a zaj dominál). */
const ALL_ISF_MIN_ACTED = 0.03
/** A szenzor késése: a vércukor-változást ennyivel később nézzük, mint az inzulin hatását. */
const SENSOR_LAG_SEC = 10 * 60
/** Egy étkezés CH-bejegyzései legfeljebb ennyi idő alatt fűződhetnek össze (a láncolás ne nyúljon végtelenre). */
const MEAL_SPAN_MAX_SEC = 60 * 60
/**
 * Bázis-sodródás: ha a böjti időszakokban a vércukor napszakban átlagosan ennél gyorsabban változik (mmol/L/óra,
 * legalább MIN_DRIFT_HOURS óra adatból, legalább MIN_DRIFT_DAYS különböző napról), a bázis nem fedi az alapigényt, és ez a korrekciók esését és az étkezések
 * végpontját is torzítja: a napszak becslései ilyenkor nem megbízhatók.
 */
const DRIFT_LIMIT = 0.3
const MIN_DRIFT_HOURS = 3
const MIN_DRIFT_DAYS = 3
/** Ezek a jegyzetek erősen befolyásolják az érzékenységet: az ablakban nem tiszta az esemény. */
export const DISTURBING_TAGS =['sport', 'betegseg', 'alkohol']
/** A felszívódási görbe rácsa: percenként 15-ös lépés 0-tól 360-ig. */
export const ABSORB_STEP = 15
export const ABSORB_POINTS = 360 / ABSORB_STEP + 1
export type AbsorbCategory = 'normal' | 'fatty' | 'fast'
/** Ennyi mmol/L teljes szénhidráthatás kell, hogy az étkezés felszívódási görbéje számítható legyen. */
const MIN_CARB_EFFECT = 1.0

interface G { ts: number; v: number }
interface Carb extends G { fatty: boolean; fast: boolean; fat: number | null; protein: number | null }
interface Bolus { ts: number; v: number; kind: 'meal' | 'correction' }

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

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
  return t.segments.indexOf(segmentAt(t, ts, true))
}
/** Van-e külön (délutános heti) profil, amire becslés készül. */
const altOn = (t: Therapy | null): t is Therapy => !!t && !!t.altEnabled && !!t.altSegments?.length && t.byTimeOfDay
/** Délutános heti napon a délutános profil napszakának indexe, különben -1. */
function altIndexAt(t: Therapy | null, ts: number): number {
  if (!altOn(t) || profileOn(t, ymdInTz(ts)) !== 'alt') return -1
  return t.altSegments!.indexOf(segmentAt(t, ts))
}
function altSegmentGroups(t: Therapy | null) {
  if (!altOn(t)) return []
  const segs = t.altSegments!
  return segs.map((s, i) => ({ index: i, start: s.start, end: segs[(i + 1) % segs.length].start, seg: s as TherapySegment | null }))
}

export interface MealEvent {
  ts: number
  seg: number
  /** Délutános heti napon a délutános profil napszaka, különben -1. */
  altSeg: number
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
  /** Zsíros / fehérjedús étkezésnek jelölve (a naplóban): a CH-arány becsléséből kimarad. */
  fatty: boolean
  /** A CH-arány végpontja (perc): a napszak hatásideje, de legalább 4 óra; rövidített ablaknál a zavarásig (≥ 3 óra). */
  endMin: number
  /** A végpontot egy későbbi esemény (korrekció, ráevés, hipó kezelése) rövidítette le. */
  truncated: boolean
  /** A végpontig felszívódott CH aránya (az alapértelmezett felszívódási modellből). */
  absorbed: number
  /** Vércukor-eltérés a végpontban a kezdőhöz képest. */
  dEnd: number | null
  /** A vércukor változása a végpont előtti 30 percben (mmol/L): pozitív, ha még emelkedik. */
  endRise: number | null
  /** Az ablakban (étkezéstől a végpontig) ténylegesen hatott inzulin, E: a saját bólus és az előző bólusok maradéka. */
  acted: number
  /** Gyors CH-nak jelölve: a CH-arány becslésében marad, csak a darabszám miatt tartjuk számon. */
  fast: boolean
  d6h: number | null
  /** Vércukor-eltérés a kezdőhöz képest, −30 … +360 perc, 5 percenként. */
  curve: (number | null)[]
}

/** Zsíros étkezés zsír / fehérje adattal: a zsír-fehérje hatásának mérése. */
export interface FpuEvent {
  ts: number
  seg: number
  carbs: number
  fat: number | null
  protein: number | null
  /** Zsír-fehérje egység. */
  units: number
  /** A hatás várt hossza, óra, és a mérés végpontja az étkezéstől, perc. */
  hours: number
  endMin: number
  startBG: number
  /** A legnagyobb emelkedés a kezdő értékhez képest 2 óra után a végpontig. */
  peakRise: number | null
  /** Eltérés a végpontban a kezdő értékhez képest. */
  endDelta: number | null
  /** Az étkezés saját bólusán felül 45 perc és 5 óra között beadott inzulin (plusz adag / korrekció), E. */
  extraGiven: number
  /** 8 órán belül a céltartomány alá ment. */
  hypoAfter: boolean
  /** Kiértékelhető: nincs más étel a végpontig, nincs hipó az ablakban, elég szenzoradat, nem gyorsan változó kezdés. */
  clean: boolean
  /** Rövidített végpont: a várt hatásidő vége előtt (de legalább 3 óra után és a hatásidő 75%-án túl) jött étel / zavarás. */
  truncated?: boolean
  /** A CH és az inzulin hatásán felüli emelés a végpontban, mmol/L (a zsír-fehérje hatása). */
  effect: number | null
  /** Ebből: a varsói érték hány %-ának felelt meg (100 = 1 egység pont annyit emelt, mint 10 g CH). */
  pct: number | null
}

export interface CorrectionEvent {
  ts: number
  seg: number
  altSeg: number
  dose: number
  startBG: number
  drop: number
  /** Megfigyelt érzékenység: legnagyobb esés ÷ egység (mmol/L/E). */
  isf: number
  /** Esés egységenként (mmol/L/E) 0 … 360 percig, 5 percenként. */
  perUnit: (number | null)[]
  /** Rövidített ablak: a hatásidőn belül, de legalább 3 óra után étel / bólus / zavaró jegyzet jött, a görbe addig tart. */
  truncated?: boolean
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
    .prepare('SELECT type, ts, value, subtype, source, fat, protein FROM entries WHERE ts >= ? AND ts < ? AND excluded = 0 ORDER BY ts')
    .all(loadFrom, loadTo) as { type: string; ts: number; value: number; subtype: string | null; source: string | null; fat: number | null; protein: number | null }[]

  const glucose: G[] = []
  // A görbéhez (kezdő- és végérték, esés, lefedettség) csak a szenzor mérései; a kézi (ujjbegyes) mérés más
  // kalibrációjú és késés nélküli, ezért nem keveredhet bele. A hipó-kizáráshoz minden mérés számít.
  const sensorGlucose: G[] = []
  const carbs: Carb[] = []
  const insulinRows: { ts: number; v: number; subtype: string | null }[] = []
  for (const r of rows) {
    const ts = Number(r.ts)
    const v = Number(r.value)
    if (r.type === 'glucose') {
      glucose.push({ ts, v })
      if (r.source !== 'manual') sensorGlucose.push({ ts, v })
    }
    else if (r.type === 'carbs') {
      carbs.push({
        ts, v, fatty: r.subtype === 'fatty', fast: r.subtype === 'fast',
        fat: r.fat == null ? null : Number(r.fat), protein: r.protein == null ? null : Number(r.protein),
      })
    }
    else insulinRows.push({ ts, v, subtype: r.subtype })
  }
  const carbTs = carbs.map((c) => c.ts)
  const boluses: Bolus[] = []
  for (const i of insulinRows) {
    const k = insulinKind(i.ts, i.subtype, carbTs, i.v)
    if (k.kind !== 'basal') boluses.push({ ts: i.ts, v: i.v, kind: k.kind })
  }
  const sample = sampler(sensorGlucose)
  // A beadás napszakának hatásideje bólusonként egyszer számolódik: az időzóna-számítás drága, és a ciklusok
  // (étkezésenként, pontonként, bólusonként) különben milliószor hívnák 90 napnál.
  // Az esemény idején érvényes beállítás (az előzményből): a régi események a régi értékekkel számolnak.
  const tAt = (ts: number): Therapy | null => (t ? (therapyAt(ts) ?? t) : null)
  const segAt = (ts: number) => segmentAt(tAt(ts)!, ts)
  const diaCache = new Map<number, number>()
  const diaAt = (ts: number) => {
    let v = diaCache.get(ts)
    if (v === undefined) {
      v = t ? actionMinutesAt(tAt(ts)!, ts) : 240
      diaCache.set(ts, v)
    }
    return v
  }
  /** A `[t0, t1)` időablakban beadott bólusok (a bólusok időrendben vannak; bináris kereséssel). */
  const bolusesBetween = (t0: number, t1: number): Bolus[] => {
    let lo = 0
    let hi = boluses.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (boluses[mid].ts < t0) lo = mid + 1
      else hi = mid
    }
    const out: Bolus[] = []
    for (let i = lo; i < boluses.length && boluses[i].ts < t1; i++) out.push(boluses[i])
    return out
  }
  /** Ennyi ideig hathat vissza legfeljebb egy korábbi bólus: a beállítható leghosszabb hatásidő (8 óra). */
  const LOOKBACK_SEC = 8 * 3600
  // A mért hatásgörbe illesztésének felső határa: a terápiában kiválasztott bólusinzulin alkalmazási
  // előírás szerinti leghosszabb hatásideje (ha nincs megadva inzulin vagy adat, 5 óra).
  const maxDia = insulinById(t?.bolusInsulin)?.maxDurationMinutes ?? 300
  const targetAt = (ts: number) => (t ? segAt(ts).target : 6)
  // Bólusonkénti hatásmodell (a beadás napszakának hatásidejével) az ablakban hatott inzulinhoz.
  const insulinPeakMin = insulinById(t?.bolusInsulin)?.peakMinutes ?? 75
  const models = new Map<number, ReturnType<typeof insulinModel>>()
  const modelOf = (ts: number) => {
    const dia = diaAt(ts)
    if (!models.has(dia)) models.set(dia, insulinModel(insulinPeakMin, dia))
    return models.get(dia)!
  }
  /** A bólusból a [t0, t1] ablakban hatott rész, E. */
  const actedIn = (b: Bolus, t0: number, t1: number) => {
    const m = modelOf(b.ts)
    return b.v * (m.iob(Math.max(0, (t0 - b.ts) / 60)) - m.iob(Math.max(0, (t1 - b.ts) / 60)))
  }
  // Zavaró jegyzetek (sport, betegség, alkohol) időpontjai.
  const disturbTs = notesBetween(loadFrom, loadTo).filter((n) => n.tags.some((x) => DISTURBING_TAGS.includes(x))).map((n) => n.ts)
  const disturbed = (t0: number, t1: number) => disturbTs.some((ts) => ts >= t0 && ts <= t1)

  // --- Étkezések: a 30 percen belüli CH-bejegyzések egy étkezés; a CH nélküli étkezési bólusok is.
  // Egy étkezés legfeljebb 1 órán át fűzhető (utána új étkezés, amelyet az előző még felszívódó CH-ja zavar).
  // Zsíros, ha bármelyik része az; gyors, ha a CH többsége gyors (egy kis gyors CH nem teszi gyorssá az egész étkezést).
  // A zsír / fehérje az étkezés részeinek összege (null, ha egyiknél sincs megadva).
  const addMacro = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0))
  const groups: {
    ts: number; last: number; carbs: number | null; fastG: number; fatty: boolean; fast: boolean; boluses: Bolus[]
    fat: number | null; protein: number | null
  }[] = []
  for (const c of carbs) {
    const g = groups.at(-1)
    if (g && g.carbs != null && c.ts - g.last <= MEAL_WINDOW_SEC && c.ts - g.ts <= MEAL_SPAN_MAX_SEC) {
      g.last = c.ts
      g.carbs += c.v
      g.fastG += c.fast ? c.v : 0
      g.fatty ||= c.fatty
      g.fast = g.fastG * 2 > g.carbs
      g.fat = addMacro(g.fat, c.fat)
      g.protein = addMacro(g.protein, c.protein)
    } else {
      groups.push({ ts: c.ts, last: c.ts, carbs: c.v, fastG: c.fast ? c.v : 0, fatty: c.fatty, fast: c.fast, boluses: [], fat: c.fat, protein: c.protein })
    }
  }
  for (const b of boluses.filter((x) => x.kind === 'meal')) {
    // Előbólus: legfeljebb 60 perccel az étkezés előtt, vagy legfeljebb 30 perccel az utolsó CH után.
    const g = groups.find((x) => x.carbs != null && b.ts >= x.ts - PREBOLUS_SEC && b.ts <= x.last + MEAL_WINDOW_SEC)
    if (g) g.boluses.push(b)
  }
  /**
   * Egy korábbi étkezés CH-ja még felszívódik-e `ts`-kor: a felszívódási idő a beállított ütemből és az étkezés
   * méretéből (nagy étkezés tovább tart), de legalább a kategória rögzített ablaka (4 / zsíros 6 / gyors 2 óra).
   */
  const carbsAbsorbingAt = (ts: number, except?: (typeof groups)[number]) => groups.some((x) => {
    if (x === except || x.carbs == null || x.ts >= ts) return false
    const cat: AbsorbCategory = x.fatty ? 'fatty' : x.fast ? 'fast' : 'normal'
    const fixed = x.fatty ? FATTY_WINDOW_MIN : x.fast ? FAST_WINDOW_MIN : MEAL_WINDOW_MIN
    return ts - x.ts < Math.max(fixed, defaultTotalMin(cat, x.carbs)) * 60
  })

  const meals: MealEvent[] = []
  const absorbSamples: { cat: AbsorbCategory; frac: (number | null)[]; grams: number }[] = []
  for (const g of groups) {
    if (g.ts < from || g.ts >= to) continue
    const startBG = sample(g.ts)
    if (startBG == null) continue
    // A görbe 6 óráig tart; a lefedettséget és a fő számokat sima étkezésnél az első 4 órára nézzük,
    // zsírosnál a teljes 6 órára (a késői emelkedés miatt).
    const { values } = curveAround(sample, g.ts, -MEAL_PRE_MIN, FATTY_WINDOW_MIN)
    const own = new Set(g.boluses)
    const firstBolusTs = g.boluses.length ? Math.min(...g.boluses.map((b) => b.ts)) : g.ts
    // Előzmény: 1 órával előtte más bólus, vagy egy korábbi étkezés még felszívódó CH-ja → nem tiszta.
    const preBolus = boluses.some((b) => !own.has(b) && b.ts >= Math.min(g.ts, firstBolusTs) - CLEAN_PRE_MIN * 60 && b.ts <= g.ts)
    const preCarbs = carbsAbsorbingAt(g.ts, g)
    const before = sample(g.ts - 900)
    const steep = before != null && Math.abs(startBG - before) / 15 >= STEEP_RATE

    // --- Felszívódási görbe tanulása: a vércukor-változásból levonva az inzulin hatását marad a szénhidrát hatása;
    // ennek az ablak végi értékéhez viszonyított hányada a felszívódott CH aránya. Az ablak a CH-arány 4 órás
    // végpontjánál rövidebb lehet: a várható felszívódási idő (a beállított ütemből és az étkezés méretéből) másfélszerese,
    // de legalább 1,5 (gyors), 2 (normál) vagy 4 óra (zsíros), legfeljebb 6 óra; az ablakban nem lehet más étel, bólus
    // vagy zavaró jegyzet. A gyors CH-t gyakran inzulin nélkül, hipó kezelésére viszik be: ott nem kell saját bólus, és
    // a hipóból / gyorsan változó vércukorról induló étkezés is számít.
    const cat: AbsorbCategory = g.fatty ? 'fatty' : g.fast ? 'fast' : 'normal'
    if (t && g.carbs && !preBolus && !preCarbs && !disturbed(g.ts - 2 * 3600, g.ts)
      && (g.boluses.length || cat === 'fast') && (cat === 'fast' || (!steep && startBG >= low))) {
      const minLearn = cat === 'fast' ? 90 : cat === 'fatty' ? MEAL_WINDOW_MIN : 120
      const learnMin = Math.min(FATTY_WINDOW_MIN, Math.max(minLearn, Math.ceil((defaultTotalMin(cat, g.carbs) * 1.5) / ABSORB_STEP) * ABSORB_STEP))
      const learnEnd = g.ts + learnMin * 60
      const learnDisturbed = boluses.some((b) => !own.has(b) && b.ts > g.ts && b.ts <= learnEnd)
        || carbs.some((c) => c.ts > g.last && c.ts <= learnEnd)
        || disturbTs.some((ts) => ts > g.ts && ts <= learnEnd)
      const win = values.slice(MEAL_PRE_MIN / STEP, (MEAL_PRE_MIN + learnMin) / STEP + 1)
      if (!learnDisturbed && win.filter((v) => v != null).length / win.length >= MIN_COVERAGE) {
        const isf = segAt(g.ts).isf
        const near = bolusesBetween(g.ts - LOOKBACK_SEC, learnEnd).filter((b) => b.ts > g.ts - diaAt(b.ts) * 60)
        const effectAt = (m: number): number | null => {
          const v = values[(MEAL_PRE_MIN + m) / STEP]
          if (v == null) return null
          let acted = 0
          for (const b of near) if (b.ts < g.ts + m * 60) acted += actedIn(b, g.ts, g.ts + m * 60)
          return v - startBG + isf * acted
        }
        const tail = [learnMin - 10, learnMin - 5, learnMin].map(effectAt).filter((x): x is number => x != null)
        const cEnd = tail.length >= 2 ? tail.reduce((a, b) => a + b, 0) / tail.length : null
        if (cEnd != null && cEnd >= MIN_CARB_EFFECT) {
          const frac: (number | null)[] = []
          for (let i = 0; i < ABSORB_POINTS; i++) {
            const m = i * ABSORB_STEP
            const e = m <= learnMin ? effectAt(m) : null
            frac.push(e == null ? null : Math.min(1.5, Math.max(-0.3, e / cEnd)))
          }
          absorbSamples.push({ cat, frac, grams: g.carbs })
        }
      }
    }

    const winMin = g.fatty ? FATTY_WINDOW_MIN : MEAL_WINDOW_MIN
    const after = values.slice(MEAL_PRE_MIN / STEP, (MEAL_PRE_MIN + winMin) / STEP + 1)
    const head = values.slice(0, (MEAL_PRE_MIN + MEAL_WINDOW_MIN) / STEP + 1)
    if (after.filter((v) => v != null).length / after.length < MIN_COVERAGE) continue
    if (head.filter((v) => v != null).length / head.length < MIN_COVERAGE) continue
    const end = g.ts + MEAL_WINDOW_MIN * 60
    const firstBolus = g.boluses.length ? Math.min(...g.boluses.map((b) => b.ts)) : null
    // A CH-arány végpontja: a napszak hatásideje, de legalább 4 (és legfeljebb 6) óra, hogy a bólus
    // a végére kifusson. Tiszta: 1 órával az étkezés / saját bólus előtt és a végpontig nincs más bólus,
    // 2 órával előtte és a végpontig nincs más CH, nincs zavaró jegyzet, és a kezdő vércukor nem változik gyorsan.
    // A zsíros / fehérjedús étkezésnél a késői emelkedés miatt a teljes 6 órás ablak a végpont.
    const fullEndMin = g.fatty ? FATTY_WINDOW_MIN : Math.min(FATTY_WINDOW_MIN, Math.max(MEAL_WINDOW_MIN, diaAt(g.ts)))
    const fullEnd = g.ts + fullEndMin * 60
    // Az étkezés utáni első zavarás (más bólus / korrekció, újabb CH, hipó kezelése, zavaró jegyzet) a végpontig.
    // Ha legalább 3 óra után jön, az étkezés a zavarásig számít (rövidített ablak); korábban nem tiszta.
    const disturbAt = Math.min(
      ...boluses.filter((b) => !own.has(b) && b.ts > g.ts && b.ts <= fullEnd).map((b) => b.ts),
      ...carbs.filter((c) => c.ts > g.last && c.ts <= fullEnd).map((c) => c.ts),
      ...disturbTs.filter((ts) => ts > g.ts && ts <= fullEnd),
      Infinity,
    )
    const truncated = Number.isFinite(disturbAt) && !g.fatty && disturbAt - g.ts >= TRUNC_MIN * 60
    const endMin = truncated ? Math.floor((disturbAt - g.ts) / 60 / STEP) * STEP : fullEndMin
    const tEnd = g.ts + endMin * 60
    const correctionAfter = boluses.some((b) => b.kind === 'correction' && b.ts > g.ts + MEAL_WINDOW_SEC && b.ts <= end)
    // Az ablakban ténylegesen hatott inzulin: a saját bólus(ok) és a korábbi bólusok még ható része.
    const acted = bolusesBetween(g.ts - LOOKBACK_SEC, tEnd + 1)
      .filter((b) => b.ts > g.ts - diaAt(b.ts) * 60)
      .reduce((a, b) => a + actedIn(b, g.ts, tEnd), 0)
    const vEnd = values[(MEAL_PRE_MIN + endMin) / STEP] ?? null
    // Emelkedik-e még a végpontban (a CH nem szívódott fel teljesen): változás az utolsó 30 percben.
    const vEnd30 = values[(MEAL_PRE_MIN + endMin - 30) / STEP] ?? null
    const endRise = vEnd != null && vEnd30 != null ? vEnd - vEnd30 : null
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
    const d6h = g.fatty && at(360) != null ? at(360)! - startBG : null
    const rating: MealEvent['rating'] =
      min < low || (d4h != null && d4h < -2) ? 'low'
      : correctionAfter || (d4h != null && d4h > 2) ? 'high'
      : peak > high ? 'spike'
      : 'ok'
    // Hipóból induló étkezés (a CH a hipó kezelése, és az ellenreguláció is emel) nem tiszta.
    const isClean = !preBolus && !preCarbs && !steep && startBG >= low && !disturbed(g.ts - 2 * 3600, g.ts)
      && (!Number.isFinite(disturbAt) || truncated)
    meals.push({
      ts: g.ts,
      seg: segIndexAt(t, g.ts),
      altSeg: altIndexAt(t, g.ts),
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
      clean: isClean,
      fatty: g.fatty,
      endMin,
      truncated,
      // A végpontig felszívódott rész: a tanult görbéből (a tárolt 60 napos elemzésé), ha van, különben az alapértelmezett.
      absorbed: g.carbs ? r2(absorbedFraction(g.fatty ? 'fatty' : g.fast ? 'fast' : 'normal', endMin, g.carbs, true)) : 1,
      dEnd: vEnd != null ? r2(vEnd - startBG) : null,
      endRise: endRise != null ? r2(endRise) : null,
      acted: r2(acted),
      fast: g.fast && !g.fatty,
      d6h: d6h != null ? r1(d6h) : null,
      // Sima étkezésnél 4 óra után a görbe már más étkezésekkel keveredne: ott levágjuk.
      curve: values.map((v, i) => (v == null || (!g.fatty && i * STEP - MEAL_PRE_MIN > MEAL_WINDOW_MIN) ? null : r2(v - startBG))),
    })
  }

  // --- Tiszta korrekciók: előtte 1 óráig és utána a beadás napszakára beállított hatásidőig étel és
  // más bólus nélkül. Ha utána sem jön semmi, a görbét tovább (legfeljebb 6 óráig) is használjuk a
  // hatásidő illesztéséhez, de csak az első étkezésig / bólusig.
  const corrections: CorrectionEvent[] = []
  let correctionCount = 0
  for (const b of boluses) {
    if (b.kind !== 'correction' || b.ts < from || b.ts >= to) continue
    correctionCount++
    const dia = diaAt(b.ts)
    const cleanEnd = b.ts + dia * 60
    const pre = b.ts - CORR_PRE_MIN * 60
    // Előtte 1 óráig nincs más bólus, CH és zavaró jegyzet.
    if (boluses.some((x) => x !== b && x.ts >= pre && x.ts <= b.ts)) continue
    if (carbs.some((c) => c.ts >= pre && c.ts <= b.ts)) continue
    if (disturbed(pre, b.ts)) continue
    // Utána a hatásidőig sincs. Ha ilyen csak legalább 3 óra után jön (pl. vacsora), a korrekció a zavarásig
    // számít (rövidített ablak, mint az étkezésnél); korábban nem tiszta.
    const disturbAt = Math.min(
      ...boluses.filter((x) => x !== b && x.ts > b.ts && x.ts <= cleanEnd).map((x) => x.ts),
      ...carbs.filter((c) => c.ts > b.ts && c.ts <= cleanEnd).map((c) => c.ts),
      ...disturbTs.filter((ts) => ts > b.ts && ts <= cleanEnd),
      Infinity,
    )
    const truncated = Number.isFinite(disturbAt)
    if (truncated && disturbAt - b.ts < TRUNC_MIN * 60) continue
    // Korábbi étkezés még felszívódó CH-ja (a mérete szerinti felszívódási ideig) és korábbi bólusok még ható
    // maradéka sem torzíthat: a 60 perces előzmény kevés (egy 1–3 órával korábbi étkezési bólus maradéka több E
    // lehet, mint maga a korrekció).
    if (carbsAbsorbingAt(b.ts)) continue
    const leftover = bolusesBetween(b.ts - LOOKBACK_SEC, b.ts).reduce((a, x) => {
      if (x === b) return a
      const m = modelOf(x.ts)
      return a + x.v * m.iob((b.ts - x.ts) / 60)
    }, 0)
    if (leftover > Math.max(CORR_LEFTOVER_MIN_E, CORR_LEFTOVER_FRAC * b.v)) continue
    const startBG = sample(b.ts)
    if (startBG == null) continue
    // Gyorsan változó kezdő vércukornál (sodródás, ráemelkedés) a „tiszta” esés nem értelmezhető.
    const bgBefore = sample(b.ts - 900)
    if (bgBefore != null && Math.abs(startBG - bgBefore) / 15 >= STEEP_RATE) continue
    // A következő étkezés vagy bólus (a hatásidő után): onnantól a görbe már nem tiszta.
    const nextEvent = truncated ? disturbAt : Math.min(
      ...boluses.filter((x) => x !== b && x.ts > cleanEnd).map((x) => x.ts),
      ...carbs.filter((c) => c.ts > cleanEnd).map((c) => c.ts),
      b.ts + CORR_WINDOW_MIN * 60 + 1,
    )
    const raw = curveAround(sample, b.ts, 0, CORR_WINDOW_MIN).values
    const values = raw.map((v, i) => (b.ts + i * STEP * 60 < nextEvent ? v : null))
    // A lefedettséget a kötelezően tiszta ablakra (a hatásidőre, rövidített ablaknál a zavarásig) nézzük.
    const winMin = truncated ? Math.floor((disturbAt - b.ts) / 60 / STEP) * STEP : Math.min(dia, CORR_WINDOW_MIN)
    const win = values.slice(0, Math.floor(winMin / STEP) + (truncated ? 0 : 1))
    if (win.filter((v) => v != null).length / win.length < MIN_COVERAGE) continue
    const drops = values.map((v) => (v == null ? null : startBG - v))
    const best = nadirDrop(drops)
    const expected = t ? b.v * segAt(b.ts).isf : null
    const minDrop = expected != null ? Math.min(MIN_DROP, Math.max(MIN_DROP_FLOOR, MIN_DROP_FRAC * expected)) : MIN_DROP
    if (best < minDrop) continue
    corrections.push({
      ts: b.ts,
      seg: segIndexAt(t, b.ts),
      altSeg: altIndexAt(t, b.ts),
      dose: b.v,
      startBG: r1(startBG),
      drop: r1(best),
      isf: r2(best / b.v),
      perUnit: drops.map((d) => (d == null ? null : r2(d / b.v))),
      ...(truncated ? { truncated: true } : {}),
    })
  }

  // --- Összevont korrekciók: a valós adatban a korrekciók többségét 3 órán belül újabb korrekció követi, ezért
  // „tisztán” kevés marad. Az egymás utáni, étel nélküli korrekciókat egy eseménynek vesszük (az első előtt 1 óráig
  // tiszta, közben és az utolsó hatásidejéig nincs étel, más bólus és zavaró jegyzet): az összes adagra jutó legnagyobb
  // esés adja az érzékenységet. A hatásidő illesztésébe nem kerül (több adag időben szétszórva torzítaná a görbét).
  const chains: { ts: number; seg: number; altSeg: number; dose: number; isf: number }[] = []
  for (const b of boluses) {
    if (b.kind !== 'correction' || b.ts < from || b.ts >= to) continue
    const pre = b.ts - CORR_PRE_MIN * 60
    if (boluses.some((x) => x !== b && x.ts >= pre && x.ts <= b.ts)) continue
    if (carbs.some((c) => c.ts >= pre && c.ts <= b.ts) || disturbed(pre, b.ts) || carbsAbsorbingAt(b.ts)) continue
    const leftover = bolusesBetween(b.ts - LOOKBACK_SEC, b.ts).reduce((a, x) => (x === b ? a : a + x.v * modelOf(x.ts).iob((b.ts - x.ts) / 60)), 0)
    if (leftover > Math.max(CORR_LEFTOVER_MIN_E, CORR_LEFTOVER_FRAC * b.v)) continue
    // A lánc: a következő bólus korrekció, legfeljebb 3 órával az előző után, közben nincs étel.
    const chain = [b]
    for (;;) {
      const last = chain[chain.length - 1]
      const next = boluses.find((x) => x.ts > last.ts && x.ts <= last.ts + CHAIN_GAP_SEC)
      if (!next || next.kind !== 'correction' || carbs.some((c) => c.ts > last.ts && c.ts <= next.ts)) break
      chain.push(next)
    }
    if (chain.length < 2) continue // az egyedülálló korrekció a tiszta korrekciók között szerepel
    const last = chain[chain.length - 1]
    const end = last.ts + diaAt(last.ts) * 60
    if (boluses.some((x) => x.ts > last.ts && x.ts <= end) || carbs.some((c) => c.ts > b.ts && c.ts <= end)) continue
    if (disturbTs.some((ts) => ts > b.ts && ts <= end)) continue
    const startBG = sample(b.ts)
    const bgBefore = sample(b.ts - 900)
    if (startBG == null || (bgBefore != null && Math.abs(startBG - bgBefore) / 15 >= STEEP_RATE)) continue
    const steps = Math.floor((end - b.ts) / 60 / STEP)
    const vals = Array.from({ length: steps + 1 }, (_, i) => sample(b.ts + i * STEP * 60))
    if (vals.filter((v) => v != null).length / vals.length < MIN_COVERAGE) continue
    const dose = chain.reduce((a, x) => a + x.v, 0)
    const best = nadirDrop(vals.map((v) => (v == null ? null : startBG - v)))
    const expected = t ? dose * segAt(b.ts).isf : null
    const minDrop = expected != null ? Math.min(MIN_DROP, Math.max(MIN_DROP_FLOOR, MIN_DROP_FRAC * expected)) : MIN_DROP
    if (best < minDrop) continue
    chains.push({ ts: b.ts, seg: segIndexAt(t, b.ts), altSeg: altIndexAt(t, b.ts), dose: r2(dose), isf: r2(best / dose) })
  }

  // --- Zsíros étkezések zsír / fehérje adattal: mennyit emelt a zsír-fehérje a CH és az inzulin hatásán felül.
  // A végpontban (a várt hatásidő végén, 4–8 óra) a megfigyelt változásból levonjuk a CH teljes hatását
  // (CH × ISF ÷ CH-arány, a napszak beállított értékeivel) és hozzáadjuk a ténylegesen hatott inzulinét (minden bólus,
  // a plusz adag és a korrekció is). Ami marad, az a zsír-fehérje hatása; CH-egyenértékre váltva, egységenként
  // 10 g-hoz (varsói érték) viszonyítva adja a saját %-ot. Kiértékelhető, ha a végpontig nincs más étel, nincs hipó,
  // elég a szenzoradat, és nem gyorsan változó vércukorról indul. A beállított ISF / CH-arányra épül.
  const fpuEvents: FpuEvent[] = []
  // A % számolásához (a bázis-sodródás levonása után, lent): a napszak ISF / CH-aránya és a mért hatás.
  const fpuRaw = new Map<FpuEvent, { isf: number; icr: number; effect: number; from: number; to: number; units: number }>()
  for (const g of groups) {
    if (g.ts < from || g.ts >= to || !g.fatty || g.carbs == null || (g.fat == null && g.protein == null)) continue
    const units = fpuUnits(g.fat, g.protein)
    if (units < 0.5) continue
    const startBG = sample(g.ts)
    if (startBG == null) continue
    const hours = fpuHours(units)
    const fullEndMin = Math.min(480, Math.max(MEAL_WINDOW_MIN, 60 + hours * 60))
    // Rövidített végpont: ha a következő étel (vagy zavaró jegyzet) legalább 3 óra után és a várt hatásidő 75%-án túl
    // jön, a végpont 5 perccel előtte van (a zsír-fehérje hatásának nagy része addigra lezajlott); korábban nem
    // kiértékelhető.
    const disturbAt = Math.min(
      ...carbs.filter((c) => c.ts > g.last && c.ts <= g.ts + fullEndMin * 60).map((c) => c.ts),
      ...disturbTs.filter((ts) => ts > g.ts && ts <= g.ts + fullEndMin * 60),
      Infinity,
    )
    const truncMin = Number.isFinite(disturbAt) ? Math.floor((disturbAt - g.ts) / 60 / STEP) * STEP - STEP : null
    const truncated = truncMin != null && truncMin >= Math.max(TRUNC_MIN, 0.75 * fullEndMin)
    const endMin = truncated ? truncMin! : fullEndMin
    const end = g.ts + endMin * 60
    const own = new Set(g.boluses)
    const extraGiven = bolusesBetween(g.ts + 45 * 60, g.ts + 5 * 3600).filter((b) => !own.has(b)).reduce((a, b) => a + b.v, 0)
    const lowIn = (t0: number, t1: number) => glucose.some((x) => x.ts > t0 && x.ts <= t1 && x.v < low)
    let peak = -Infinity
    for (let m = 120; m <= endMin; m += STEP) {
      const v = sample(g.ts + m * 60)
      if (v != null && v > peak) peak = v
    }
    const tail = [endMin - 10, endMin - 5, endMin].map((m) => sample(g.ts + m * 60)).filter((x): x is number => x != null)
    const vEnd = tail.length >= 2 ? tail.reduce((a, b) => a + b, 0) / tail.length : null
    const before = sample(g.ts - 900)
    const steep = before != null && Math.abs(startBG - before) / 15 >= STEEP_RATE
    const clean = vEnd != null && !steep && startBG >= low
      && curveAround(sample, g.ts, 0, endMin).covered >= MIN_COVERAGE
      && !carbs.some((c) => c.ts > g.last && c.ts <= end)
      && !carbsAbsorbingAt(g.ts, g)
      && !lowIn(g.ts, end)
      && !disturbed(g.ts - 2 * 3600, end)
    let effect: number | null = null
    let pct: number | null = null
    if (clean && t) {
      const s = segAt(g.ts)
      const acted = bolusesBetween(g.ts - LOOKBACK_SEC, end)
        .filter((b) => b.ts > g.ts - diaAt(b.ts) * 60)
        .reduce((a, b) => a + actedIn(b, g.ts, end), 0)
      effect = vEnd! - startBG - (g.carbs * s.isf) / s.icr + acted * s.isf
      pct = Math.round(((effect * s.icr) / s.isf / (units * FPU_CARB_G)) * 100)
    }
    const ev: FpuEvent = {
      ts: g.ts, seg: segIndexAt(t, g.ts), carbs: g.carbs, fat: g.fat, protein: g.protein, units, hours, endMin,
      startBG: r1(startBG),
      peakRise: Number.isFinite(peak) ? r1(peak - startBG) : null,
      endDelta: vEnd != null ? r1(vEnd - startBG) : null,
      extraGiven: r2(extraGiven),
      hypoAfter: lowIn(g.ts, g.ts + 8 * 3600),
      clean,
      ...(truncated ? { truncated: true } : {}),
      effect: effect != null ? r1(effect) : null,
      pct,
    }
    fpuEvents.push(ev)
    if (effect != null && t) {
      const s = segAt(g.ts)
      fpuRaw.set(ev, { isf: s.isf, icr: s.icr, effect, from: g.ts, to: end, units })
    }
  }

  // Bázisellenőrzés (böjti időszakok sodródása), és ebből napszakonként az átlagos sodródás a becslések megbízhatóságához.
  const basal = basalCheck(sensorGlucose, glucose, carbs, boluses, diaAt, low, disturbTs, segmentGroups(t), from, Math.min(to, Math.floor(Date.now() / 1000)))
  // Zsír-fehérje %: a 4–8 órás ablakban a bázis-sodródás (az órák mért böjti változása, ahol legalább 1 óra adat van)
  // nem a zsír-fehérje hatása: levonjuk, mielőtt %-ra váltjuk.
  const driftBetween = (t0: number, t1: number) => {
    let d = 0
    for (let ts = t0; ts < t1; ts += 300) {
      const x = basal.hours[Math.floor(minuteOfDayInTz(ts) / 60)]
      if (x.slope != null && x.hours >= 1) d += x.slope / 12
    }
    return d
  }
  for (const [ev, r] of fpuRaw) {
    const eff = r.effect - driftBetween(r.from, r.to)
    ev.effect = r1(eff)
    ev.pct = Math.round(((eff * r.icr) / r.isf / (r.units * FPU_CARB_G)) * 100)
  }
  // --- Érzékenység minden adatból (az autotune módszere szerint): 5 percenként, ahol étel nem hat (a CH a mérete
  // szerinti felszívódási időn túl van), nincs hipó és zavaró jegyzet, és az inzulin érdemben hat, a mért változást
  // (a szenzor késésével eltolva, a böjti órákban mért bázis-sodródást levonva) elosztjuk az 5 perc alatt hatott
  // inzulinnal. Napszakonként a hatott inzulinnal súlyozott medián: így a tiszta korrekciók hiánya nem akadály.
  const allIsf = new Map<string, { items: { v: number; w: number }[]; days: Set<string> }>()
  const nowSec = Math.floor(Date.now() / 1000)
  for (let ts = Math.ceil(from / 300) * 300; ts < Math.min(to, nowSec) - SENSOR_LAG_SEC - 300; ts += 300) {
    const a = sample(ts + SENSOR_LAG_SEC)
    const b = sample(ts + SENSOR_LAG_SEC + 300)
    if (a == null || b == null || a < low || b < low) continue
    if (carbsAbsorbingAt(ts + 300) || disturbed(ts - 6 * 3600, ts + 300)) continue
    let acted = 0
    for (const x of bolusesBetween(ts - LOOKBACK_SEC, ts + 300)) if (x.ts > ts - diaAt(x.ts) * 60) acted += actedIn(x, Math.max(ts, x.ts), ts + 300)
    if (acted < ALL_ISF_MIN_ACTED) continue
    const hr = basal.hours[Math.floor(minuteOfDayInTz(ts) / 60)]
    const drift = hr.slope != null && hr.hours >= 1 ? hr.slope / 12 : 0
    const v = Math.max(-5, Math.min(10, (a - b + drift) / acted))
    const ai = altIndexAt(t, ts)
    const key = ai >= 0 ? `a${ai}` : `b${segIndexAt(t, ts)}`
    const o = allIsf.get(key) ?? { items: [], days: new Set<string>() }
    o.items.push({ v, w: acted })
    o.days.add(ymdInTz(ts))
    allIsf.set(key, o)
  }
  const allIsfOf = (key: string, drifting: boolean) => {
    const o = allIsf.get(key)
    if (!o || o.items.length < ALL_ISF_MIN_STEPS || o.days.size < MIN_DRIFT_DAYS) return null
    const v = weightedMedian(o.items)
    return v == null || v <= 0 ? null : { value: r1(v), n: o.items.length, hours: r1(o.items.length / 12), days: o.days.size, all: true, unreliable: drifting }
  }

  const fpuPcts = fpuEvents.filter((e) => e.pct != null).map((e) => e.pct!).sort((a, b) => a - b)
  const fpuIqr = fpuPcts.length >= MIN_EVENTS ? Math.round(quantile(fpuPcts, 0.75) - quantile(fpuPcts, 0.25)) : null
  const fpuMedian = fpuPcts.length >= MIN_EVENTS ? Math.round(median(fpuPcts)!) : null
  const fpu = {
    events: [...fpuEvents].reverse(),
    estimate: fpuMedian != null
      ? {
          pct: fpuMedian,
          n: fpuPcts.length,
          /** Az étkezések középső felének szélessége (%-pont): nagy szórásnál nem megbízható. */
          iqr: fpuIqr,
          reliable: fpuPcts.length >= FPU_GOOD_EVENTS && fpuIqr! <= FPU_MAX_IQR && fpuMedian <= 100,
          // Tartósan a varsói érték fölött: inkább a beállított ISF / CH-arány torzít (minden modellhiba ide kerül).
          mismatch: fpuMedian > 100,
        }
      : null,
    current: t?.fpuPercent ?? null,
  }

  // --- Napszakonkénti összesítés és becslés.
  const allIcr: number[] = [] // az összes napszak CH-arány értékei az „egész nap” becsléshez
  const allIcrMeals: MealEvent[] = []
  // A napszak óráinak súlyozott átlaga; a határon levő óra csak a napszakba eső perceivel számít (05:30 → az 5 óra fele).
  const driftOf = (start: string, end: string): number | null => {
    const m0 = hmToMin(start)
    const m1 = hmToMin(end)
    const span = m1 > m0 ? m1 - m0 : m1 + 1440 - m0
    let sum = 0
    let hours = 0
    const days = new Set<string>()
    for (let h = Math.floor(m0 / 60); h * 60 < m0 + span; h++) {
      const frac = (Math.min((h + 1) * 60, m0 + span) - Math.max(h * 60, m0)) / 60
      const x = basal.hours[h % 24]
      if (x.slope == null || frac <= 0) continue
      sum += x.slope * x.hours * frac
      hours += x.hours * frac
      for (const d of x.days) days.add(d)
    }
    return hours >= MIN_DRIFT_HOURS && days.size >= MIN_DRIFT_DAYS ? r2(sum / hours) : null
  }

  // Váltott műszaknál a becslés profilonként: az alap napszakokhoz csak az alap profil napjai, a délutános héthez a
  // délutános napok (más a beállítás); az étkezés-összesítő (meals / fatty) az alap napszakoknál minden napot mutat.
  // Napszakonkénti eredmény a szenzoradatból (céltartományban, alatta, átlag): az alap napszakoknál minden nap,
  // a délutános hétnél csak a délutános napok.
  const outAcc = new Map<string, { n: number; inR: number; below: number; sum: number }>()
  for (const p of sensorGlucose) {
    if (p.ts < from || p.ts >= to) continue
    const ai = altIndexAt(t, p.ts)
    for (const k of ai >= 0 ? [`b${segIndexAt(t, p.ts)}`, `a${ai}`] : [`b${segIndexAt(t, p.ts)}`]) {
      const o = outAcc.get(k) ?? { n: 0, inR: 0, below: 0, sum: 0 }
      o.n++
      if (p.v < low) o.below++
      else if (p.v <= high) o.inR++
      o.sum += p.v
      outAcc.set(k, o)
    }
  }
  const outcomeOf = (k: string) => {
    const o = outAcc.get(k)
    return o && o.n >= 12 ? { tir: Math.round((100 * o.inR) / o.n), below: r1((100 * o.below) / o.n), avg: r1(o.sum / o.n), hours: r1(o.n / 12) } : null
  }
  const buildSeg = (sg: ReturnType<typeof segmentGroups>[number], alt: boolean) => {
    const segAll = meals.filter((m) => (alt ? m.altSeg === sg.index : m.seg === sg.index))
    const segMeals = segAll.filter((m) => !m.fatty)
    const fattyMeals = segAll.filter((m) => m.fatty)
    // A zsíros / fehérjedús étkezések kimaradnak a CH-arány becsléséből (a késői emelkedés torzítana).
    const cleanCarbMeals = segMeals.filter((m) => (alt || m.altSeg < 0) && m.clean && m.carbs && m.bolus > 0 && m.dEnd != null)
    const segCorr = corrections.filter((c) => (alt ? c.altSeg === sg.index : c.seg === sg.index && c.altSeg < 0))
    const segChains = chains.filter((c) => (alt ? c.altSeg === sg.index : c.seg === sg.index && c.altSeg < 0))

    // ISF és hatásidő: a tiszta korrekciók egységnyi esési görbéjére illesztett modellből.
    const actionFit = segCorr.length >= MIN_EVENTS ? fitAction(segCorr, maxDia) : null

    // CH-arány: mennyi inzulin kellett volna ahhoz, hogy a végpontban (a napszak hatásideje, de legalább
    // 4 óra) a kezdő értéken legyen?
    //   étkezésre jutó inzulin = az ablakban ténylegesen hatott inzulin + (végpont − kezdő érték) ÷ ISF
    // A ténylegesen hatott inzulin a saját bólus(ok)nak és a korábbi bólusok még ható maradékának az
    // a része, ami az étkezés és a végpont között hatott (inzulinmodellből).
    const isfForIcr = sg.seg?.isf ?? null
    const icrValues: number[] = []
    // A ténylegesen felhasznált étkezések: a darabszám, a megbízhatósági címke, a „még emelkedik” jelzés és a görbe
    // is ezekből készül, hogy ugyanarról az étkezéskörről szóljanak, mint maga a becslés.
    const icrMeals: MealEvent[] = []
    if (isfForIcr) {
      for (const m of cleanCarbMeals) {
        // Az étkezés idején érvényes ISF-fel (egy későbbi módosítás ne írja át a régi étkezéseket).
        const mealNeeded = m.acted + m.dEnd! / segAt(m.ts).isf
        // Csak a végpontig felszívódott CH számít (rövidített ablaknál, vagy nagy étkezésnél még nem szívódott fel minden).
        if (mealNeeded > 0.2) {
          icrValues.push((m.carbs! * m.absorbed) / mealNeeded)
          icrMeals.push(m)
        }
      }
    }
    // Terápiás beállítás nélkül nincs CH-arány becslés: ott a tiszta étkezések maguk számítanak.
    const usedMeals = isfForIcr ? icrMeals : cleanCarbMeals
    const icrEst = icrValues.length >= MIN_EVENTS ? r1(median(icrValues)!) : null
    // Megbízhatatlan, ha a tiszta étkezések többségénél a vércukor a végpontban még emelkedik: a CH ilyenkor nem
    // szívódott fel teljesen, és a CH-arány túl nagynak (kevés inzulin) jönne ki.
    const risingN = usedMeals.filter((m) => (m.endRise ?? 0) > ICR_RISING).length
    const icrRising = usedMeals.length > 0 && risingN * 2 >= usedMeals.length
    allIcr.push(...icrValues)
    allIcrMeals.push(...icrMeals)
    // Jelentős bázis-sodródás (bármelyik irányba): a korrekciók esése és az étkezések végpontja is torzul.
    const drift = driftOf(sg.start, sg.end)
    const drifting = drift != null && Math.abs(drift) >= DRIFT_LIMIT

    return {
      index: sg.index,
      start: sg.start,
      end: sg.end,
      therapy: sg.seg ? { target: sg.seg.target, isf: sg.seg.isf, icr: sg.seg.icr, actionMinutes: sg.seg.actionMinutes ?? t!.actionMinutes } : null,
      counts: {
        meals: segMeals.length,
        fattyMeals: fattyMeals.length,
        fastMeals: segMeals.filter((m) => m.fast).length,
        cleanMeals: usedMeals.length,
        truncatedMeals: usedMeals.filter((m) => m.truncated).length,
        cleanCorrections: segCorr.length,
        /** Összevont (egymás utáni) korrekciók: csak az érzékenység becsléséhez. */
        chainedCorrections: segChains.length,
      },
      meals: mealSummary(segMeals),
      fatty: mealSummary(fattyMeals),
      /** Eredmény a szenzoradatból: céltartományban (%), alatta (%), átlag (mmol/L). */
      outcome: outcomeOf(`${alt ? 'a' : 'b'}${sg.index}`),
      // A CH-arány becsléséhez használt tiszta étkezések görbéje (Terápia oldal).
      clean: mealSummary(usedMeals),
      // A napszak tiszta korrekcióinak mért hatásgörbéje (kevés eseménynél is, tájékoztatásul), a napszak hatásidejével.
      action: actionSummary(segCorr, t, maxDia, sg.seg?.actionMinutes ?? undefined),
      estimate: {
        // Ha az illesztés az inzulin leghosszabb hatásidején akadt meg, más is csökkentette a
        // vércukrot (pl. bázis): az érzékenység és a hatásidő ilyenkor nem megbízható.
        // Kevés tiszta korrekciónál az összevont korrekciókkal együtt (adaggal súlyozott medián, tájékoztató).
        isf: actionFit
          ? { value: actionFit.isf, n: actionFit.n, unreliable: actionFit.unreliable || drifting }
          : chainIsf(segCorr, segChains, drifting) ?? allIsfOf(`${alt ? 'a' : 'b'}${sg.index}`, drifting),
        icr: icrEst != null ? { value: icrEst, n: icrValues.length, unreliable: icrRising || drifting, rising: risingN } : null,
        action: actionFit ? { ...actionFit, unreliable: actionFit.unreliable || drifting } : null,
        /** A napszak böjti időszakainak átlagos vércukor-változása (mmol/L/óra), ha van rá elég adat. */
        drift,
        drifting,
      },
    }
  }
  const segments = segmentGroups(t).map((sg) => buildSeg(sg, false))
  const altSegments = altSegmentGroups(t).map((sg) => buildSeg(sg, true))

  // Egész nap (összevont) becslés: ha napszakonként kevés az esemény, de összesen elég, ez tájékoztatásul szolgál.
  // Az érzékenység és a hatásidő a mért eseményekből jön (napszaktól függetlenül); a CH-arány az étkezéseket a saját
  // napszakuk beállított érzékenységével számolja, majd a mediánt veszi.
  const overallFit = corrections.length >= MIN_EVENTS ? fitAction(corrections, maxDia) : null
  // Ha bármelyik napszakban sodródik a bázis, az összesített becslés sem megbízható (a napszak jelzése nem veszhet el).
  const anyDrifting = [...segments, ...altSegments].some((s) => s.estimate.drifting)
  const overallRising = allIcrMeals.filter((m) => (m.endRise ?? 0) > ICR_RISING).length
  const overall = {
    counts: { cleanCorrections: corrections.length, cleanMeals: allIcr.length },
    estimate: {
      isf: overallFit ? { value: overallFit.isf, n: overallFit.n, unreliable: overallFit.unreliable || anyDrifting } : null,
      icr: allIcr.length >= MIN_EVENTS ? { value: r1(median(allIcr)!), n: allIcr.length, unreliable: overallRising * 2 >= allIcrMeals.length || anyDrifting, rising: overallRising } : null,
      action: overallFit && { ...overallFit, unreliable: overallFit.unreliable || anyDrifting },
    },
  }

  // Amikor az adagolás működik: a jól sikerült étkezések és a tiszta korrekciók jellemző (25–75%) tartománya, egész időszakra.
  const range = (xs: number[]) => {
    const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
    return s.length ? { lo: r1(quantile(s, 0.25)), mid: r1(quantile(s, 0.5)), hi: r1(quantile(s, 0.75)) } : null
  }
  const okMeals = meals.filter((m) => m.rating === 'ok' && m.carbs && m.bolus > 0)
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0)
  const works = {
    meals: okMeals.length ? {
      n: okMeals.length, of: meals.length,
      carbs: range(okMeals.map((m) => m.carbs!)), bolus: range(okMeals.map((m) => m.bolus)),
      gPerUnit: r1(sum(okMeals.map((m) => m.carbs!)) / sum(okMeals.map((m) => m.bolus))),
    } : null,
    corrections: corrections.length ? {
      n: corrections.length, of: correctionCount,
      startBG: range(corrections.map((c) => c.startBG)), dose: range(corrections.map((c) => c.dose)), drop: range(corrections.map((c) => c.drop)),
      dropPerUnit: r1(sum(corrections.map((c) => c.drop)) / sum(corrections.map((c) => c.dose))),
    } : null,
    mealRows: [] as { carbs: number; n: number; good: number; spike: number; high: number; low: number; dose: number | null; estimated: boolean }[],
    corrRows: [] as { bg: number; n: number; good: number; high: number; low: number; dose: number | null; estimated: boolean }[],
  }
  // Táblázat: hány g CH-hoz mennyi inzulin (jó = a cukor a célban maradt); ahol nincs jó eset, az átlagos g/E arányból becsült adag.
  const roundHalf = (x: number) => Math.max(0.5, Math.round(x * 2) / 2)
  const nearest = (centers: number[], x: number, half: number) => centers.find((c) => Math.abs(x - c) < half)
  const mealWithCarbs = meals.filter((m) => m.carbs && m.bolus > 0)
  for (const c of [20, 30, 40, 50, 60]) {
    const inB = mealWithCarbs.filter((m) => nearest([c], m.carbs!, 5) != null)
    const good = inB.filter((m) => m.rating === 'ok')
    const med = good.length ? median(good.map((m) => m.bolus)) : null
    const est = med == null && works.meals ? roundHalf(c / works.meals.gPerUnit) : null
    works.mealRows.push({ carbs: c, n: inB.length, good: good.length, spike: inB.filter((m) => m.rating === 'spike').length, high: inB.filter((m) => m.rating === 'high').length, low: inB.filter((m) => m.rating === 'low').length, dose: med != null ? r1(med) : est, estimated: med == null && est != null })
  }
  // Korrekció: jó, ha a legmélyebb pont a céltartományban maradt (nem maradt magas, nem ment alacsonyra).
  const mid = (low + high) / 2
  for (const bg of [10, 15, 20]) {
    const inB = corrections.filter((x) => (bg === 20 ? x.startBG >= 17.5 : Math.abs(x.startBG - bg) < 2.5))
    const good = inB.filter((x) => x.startBG - x.drop >= low && x.startBG - x.drop <= high)
    const med = good.length ? median(good.map((x) => x.dose)) : null
    const est = med == null && works.corrections && works.corrections.dropPerUnit > 0 ? roundHalf((bg - mid) / works.corrections.dropPerUnit) : null
    works.corrRows.push({ bg, n: inB.length, good: good.length, high: inB.filter((x) => x.startBG - x.drop > high).length, low: inB.filter((x) => x.startBG - x.drop < low).length, dose: med != null ? r1(med) : est, estimated: med == null && est != null })
  }

  return {
    therapySet: !!t,
    works,
    overall,
    coverage: glucoseCoverage(sensorGlucose, from, Math.min(to, Math.floor(Date.now() / 1000))),
    counts: { meals: meals.length, corrections: correctionCount, cleanCorrections: corrections.length },
    segments,
    /** A délutános hét napszakai (külön profil), ha be van kapcsolva. */
    altSegments,
    action: actionSummary(corrections, t, maxDia),
    absorption: {
      normal: absorptionProfile(absorbSamples.filter((x) => x.cat === 'normal')),
      fatty: absorptionProfile(absorbSamples.filter((x) => x.cat === 'fatty')),
      fast: absorptionProfile(absorbSamples.filter((x) => x.cat === 'fast')),
    },
    maxDia,
    basal,
    fpu,
  }
}

export interface AbsorptionProfile {
  /** Hány tiszta étkezésből készült. */
  n: number
  /** Legalább MIN_EVENTS étkezés: a becslés használható az előrejelzéshez. */
  usable: boolean
  /** A felszívódott CH aránya (0 … 1) 15 percenként, 0-tól 360 percig. */
  profile: number[] | null
  /** A tanulásban részt vevő étkezések mediánja, g: a görbe erre az étkezésméretre érvényes. */
  refGrams: number | null
  /** Ennyi perc után szívódik fel a CH 10 / 50 / 90%-a. */
  t10: number | null
  t50: number | null
  t90: number | null
}

/**
 * Az étkezésenkénti arányokból a felszívódási görbe a tanuló étkezések medián méretére (refGrams). Az előrejelzés a
 * görbét a méret szerint nyújtja (nagyobb étkezés tovább tart), ezért itt fordítva: minden étkezés idejét a méretével
 * a referenciaméretre normáljuk, mielőtt pontonként a mediánt vesszük; a mediánra monoton illesztés kerül.
 */
function absorptionProfile(items: { frac: (number | null)[]; grams: number }[]): AbsorptionProfile {
  const n = items.length
  const empty: AbsorptionProfile = { n, usable: false, profile: null, refGrams: null, t10: null, t50: null, t90: null }
  if (n < MIN_EVENTS) return empty
  const ref = median(items.map((x) => x.grams))!
  // Egy étkezés aránya a referenciaidő `i`. pontjában: a saját idejében `i · lépés · nyújtás` percnél (interpolálva).
  const samples = items.map((x) => {
    const sc = scaleFor(x.grams, ref)
    return Array.from({ length: ABSORB_POINTS }, (_, i) => {
      const pos = i * sc
      const j = Math.floor(pos)
      const a = x.frac[j]
      const b = x.frac[Math.min(j + 1, ABSORB_POINTS - 1)]
      if (a == null || j >= ABSORB_POINTS) return null
      return b == null || j + 1 >= ABSORB_POINTS ? (pos === j ? a : null) : a + (b - a) * (pos - j)
    })
  })
  const med: (number | null)[] = []
  const cnt: number[] = []
  for (let i = 0; i < ABSORB_POINTS; i++) {
    const vals = samples.map((x) => x[i]).filter((v): v is number => v != null)
    med.push(vals.length >= 2 ? median(vals) : null)
    cnt.push(vals.length)
  }
  med[0] = 0
  cnt[0] = Math.max(1, cnt[0])
  const lastIdx = med.findLastIndex((v) => v != null)
  if (lastIdx < 4) return empty
  const fit = isotonic(med, cnt)
  const prof: number[] = []
  let run = 0
  for (let i = 0; i < ABSORB_POINTS; i++) {
    run = i > lastIdx ? 1 : (fit[i] ?? run)
    prof.push(Math.min(1, Math.max(0, run)))
  }
  const peak = Math.max(...prof)
  if (peak <= 0) return empty
  const norm = prof.map((v) => v / peak)
  const when = (q: number) => {
    const i = norm.findIndex((v) => v >= q)
    if (i <= 0) return i === 0 ? 0 : null
    const a = norm[i - 1]
    const b = norm[i]
    return Math.round((i - 1 + (b > a ? (q - a) / (b - a) : 1)) * ABSORB_STEP)
  }
  return { n, usable: true, profile: norm.map(r2), refGrams: Math.round(ref), t10: when(0.1), t50: when(0.5), t90: when(0.9) }
}

function glucoseCoverage(g: G[], from: number, to: number): number {
  if (to <= from) return 0
  const n = g.filter((p) => p.ts >= from && p.ts < to).length
  return Math.min(100, Math.round((100 * n) / ((to - from) / 300)))
}

/** Étkezések összesítése egy napszakra: medián görbe (eltérés a kezdőtől) és fő számok. */
function mealSummary(meals: MealEvent[]) {
  if (!meals.length) return null
  // Csak addig, ameddig van adat (sima étkezésnél 4, zsírosnál 6 óra).
  const lastIdx = Math.max(...meals.map((m) => m.curve.findLastIndex((v) => v != null)))
  const minutes = meals[0].curve.slice(0, lastIdx + 1).map((_, i) => -MEAL_PRE_MIN + i * STEP)
  // A medián egy étkezésből is látszik; a 25–75%-os sávhoz legalább MIN_EVENTS étkezés kell (kettőből a „sáv” csak a
  // két görbe közti rés, és megbízhatóbbnak látszana, mint ami).
  const band = (q: number) =>
    minutes.map((_, i) => {
      const vals = meals.map((m) => m.curve[i]).filter((v): v is number => v != null).sort((a, b) => a - b)
      return vals.length >= (q === 0.5 ? 1 : MIN_EVENTS) ? r2(quantile(vals, q)) : null
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
    d6h: med((m) => m.d6h),
    preBolus: med((m) => m.preBolusMin),
    ratings,
    curve: { minutes, p25: band(0.25), p50: band(0.5), p75: band(0.75) },
  }
}

/**
 * Az egységnyi esési görbék mediánja 5 percenként. Ahol az események felénél kevesebbnél (de legalább
 * MIN_EVENTS-nél) van adat, ott nincs érték: a görbe vége kevés (főleg éjszakai) eseményből torzítaná az illesztést.
 */
/**
 * Az egységnyi esés időpontonkénti mediánja, az adag nagyságával súlyozva: egy 1 E-s korrekciónál a mérési zaj és a
 * bázis-sodródás egységnyire vetítve négyszer akkora, mint egy 4 E-snél, ezért a kis adagok kevesebbet számítanak.
 */
/**
 * ISF a tiszta és az összevont (egymás utáni) korrekciókból, adaggal súlyozott mediánnal; akkor, ha a tiszta
 * korrekciók egymagukban kevesek, de az összevontakkal együtt legalább MIN_EVENTS esemény van.
 */
function chainIsf(clean: CorrectionEvent[], chained: { dose: number; isf: number }[], drifting: boolean) {
  if (!chained.length || clean.length + chained.length < MIN_EVENTS) return null
  const v = weightedMedian([...clean.map((c) => ({ v: c.isf, w: c.dose })), ...chained.map((c) => ({ v: c.isf, w: c.dose }))])
  return v == null ? null : { value: r1(v), n: clean.length + chained.length, chained: chained.length, unreliable: drifting }
}

/**
 * Az összes tiszta korrekció együtt: az esési görbék a teljes eséshez viszonyítva (0 → 1),
 * medián és sáv, mellette az illesztett és a jelenleg beállított modell.
 */
function actionSummary(events: CorrectionEvent[], t: Therapy | null, maxDia: number, dia?: number) {
  const current = t ? { peak: insulinById(t.bolusInsulin)?.peakMinutes ?? 75, dia: dia ?? t.actionMinutes } : null
  if (!events.length) return { n: 0, observed: null, fit: null, current }
  const fit = events.length >= MIN_EVENTS ? fitAction(events, maxDia) : null
  // Viszonyítás: az illesztett teljes esés, vagy illesztés nélkül az események legnagyobb esése.
  const scale = (e: CorrectionEvent) => fit?.isf ?? e.isf
  const minutes = events[0].perUnit.map((_, i) => i * STEP)
  // Ugyanaz a minimum, mint az illesztésnél (medianCurve): ahol kevés esemény van (a görbe vége), ott nincs pont;
  // a 25–75%-os sávhoz ezen felül legalább MIN_EVENTS esemény kell, különben megbízhatóbbnak látszana, mint ami.
  const need = Math.min(events.length, Math.max(MIN_EVENTS, Math.ceil(events.length / 2)))
  const band = (q: number, min: number) =>
    minutes.map((_, i) => {
      const v = events.map((e) => (e.perUnit[i] == null ? null : e.perUnit[i]! / scale(e)))
        .filter((x): x is number => x != null).sort((a, b) => a - b)
      return v.length && v.length >= min ? r2(quantile(v, q)) : null
    })
  const bandMin = Math.max(MIN_EVENTS, need)
  return {
    n: events.length,
    observed: { minutes, p25: band(0.25, bandMin), p50: band(0.5, need), p75: band(0.75, bandMin) },
    fit,
    current,
  }
}

const BASAL_SETTLE_MIN = 30 // a bólus hatásideje után ennyit még várunk (a hatás vége elnyúlhat)
const BASAL_MIN_RUN_STEPS = 24 // legalább 2 óra összefüggő éhgyomri szakasz kell (5 perces lépés)
const DISTURB_BLOCK_SEC = 6 * 3600 // sport / betegség / alkohol jegyzet után ennyi ideig nem böjti szakasz

/**
 * Bázisellenőrzés: azokban az időszakokban, amikor étel és bólus nem befolyásolja a vércukrot, mennyit változik a
 * vércukor óránként. Ha a bázis jól fedi az alapigényt, ez közel nulla. Kimarad: az étkezés felszívódása (a mérete
 * szerint, de legalább 4 óra — zsírosnál 6, a zsír-fehérje hatásáig —, gyorsnál 2), a bólus hatásideje + fél óra,
 * hipó után 2 óra, sport / betegség / alkohol jegyzet után 6 óra, és a 2 óránál rövidebb szakaszok.
 * Eredmény: napóránkénti átlagos sodródás (mmol/L/óra) és a terápia napszakai szerinti összesítés.
 */
function basalCheck(
  sensorGlucose: G[], glucose: G[], carbs: Carb[], boluses: Bolus[], diaAt: (ts: number) => number, low: number,
  disturbTs: number[], segs: { start: string; end: string }[], from: number, to: number,
) {
  const carbBlockMin = (c: Carb) => {
    const cat: AbsorbCategory = c.fatty ? 'fatty' : c.fast ? 'fast' : 'normal'
    const fixed = c.fatty ? FATTY_WINDOW_MIN : c.fast ? FAST_WINDOW_MIN : MEAL_WINDOW_MIN
    const fpu = c.fatty ? fpuUnits(c.fat, c.protein) : 0
    return Math.max(fixed, defaultTotalMin(cat, c.v), fpu >= 0.5 ? 60 + fpuHours(fpu) * 60 : 0)
  }
  const sample = sampler(sensorGlucose)
  // A „nem böjt” időszakok (étkezés, ható bólus, hipó utáni 2 óra) összefésülve, majd 5 perces
  // rácson egyetlen végigsöpréssel jelöljük, mely időpontok számítanak.
  const blocked: [number, number][] = [
    ...carbs.map((c): [number, number] => [c.ts, c.ts + carbBlockMin(c) * 60]),
    ...boluses.map((b): [number, number] => [b.ts, b.ts + (diaAt(b.ts) + BASAL_SETTLE_MIN) * 60]),
    ...glucose.filter((g) => g.v < low).map((g): [number, number] => [g.ts, g.ts + 2 * 3600]),
    ...disturbTs.map((ts): [number, number] => [ts, ts + DISTURB_BLOCK_SEC]),
  ].sort((a, b) => a[0] - b[0])
  const LAG = 15 * 60 // a változást 15 perces lépésekben mérjük (kevésbé zajos)
  const start = Math.ceil(from / 300) * 300
  const steps = Math.max(0, Math.floor((to - start) / 300) + 1)
  const ok = new Uint8Array(steps)
  let bi = 0
  let blockedUntil = -Infinity
  for (let i = 0; i < steps; i++) {
    const ts = start + i * 300
    while (bi < blocked.length && blocked[bi][0] <= ts) blockedUntil = Math.max(blockedUntil, blocked[bi++][1])
    ok[i] = ts >= blockedUntil ? 1 : 0
  }
  // A rövid (2 óránál kevesebb) böjti foszlányok kimaradnak: ott az előző hatás vége és a zaj dominál.
  for (let i = 0; i < steps;) {
    if (!ok[i]) { i++; continue }
    let j = i
    while (j < steps && ok[j]) j++
    if (j - i < BASAL_MIN_RUN_STEPS) ok.fill(0, i, j)
    i = j
  }

  const hours = Array.from({ length: 24 }, () => ({ sum: 0, n: 0, days: new Set<string>() }))
  const lagSteps = LAG / 300
  for (let i = 0; i + lagSteps < steps; i++) {
    if (!ok[i] || !ok[i + lagSteps]) continue
    const ts = start + i * 300
    const a = sample(ts)
    const b = sample(ts + LAG)
    if (a == null || b == null) continue
    const h = Math.floor(minuteOfDayInTz(ts + LAG / 2) / 60)
    hours[h].sum += (b - a) * (3600 / LAG)
    hours[h].n++
    hours[h].days.add(ymdInTz(ts))
  }
  // Összesítés a terápia napszakai szerint; a határon levő óra a napszakba eső perceivel számít.
  return {
    hours: hours.map((x, h) => ({ h, slope: x.n ? r2(x.sum / x.n) : null, hours: r1((x.n * 5) / 60), days: [...x.days] })),
    blocks: segs.map((sg) => {
      const m0 = hmToMin(sg.start)
      const m1 = hmToMin(sg.end)
      const span = m1 > m0 ? m1 - m0 : m1 + 1440 - m0
      let sum = 0
      let n = 0
      const days = new Set<string>()
      for (let h = Math.floor(m0 / 60); h * 60 < m0 + span; h++) {
        const frac = (Math.min((h + 1) * 60, m0 + span) - Math.max(h * 60, m0)) / 60
        const x = hours[h % 24]
        if (frac <= 0 || !x.n) continue
        sum += x.sum * frac
        n += x.n * frac
        for (const d of x.days) days.add(d)
      }
      return {
        label: span === 1440 ? 'Egész nap' : `${sg.start}–${sg.end}`,
        slope: n ? r2(sum / n) : null,
        hours: r1((n * 5) / 60),
        days: days.size,
      }
    }),
  }
}
