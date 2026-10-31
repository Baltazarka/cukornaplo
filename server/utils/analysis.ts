// Elemzés a mért adatokból: tiszta étkezések és tiszta korrekciók keresése, étkezés utáni
// görbék, és ezekből becslés a CH-arányra, az érzékenységi tényezőre (ISF) és az inzulin
// hatásidejére, napszakonként. Minden becslés javaslat: a terápia módosítása orvosi döntés.
import type { Therapy, TherapySegment } from '#shared/types/therapy'
import { db } from './db'
import { therapy, activeSegments, segmentAt, actionMinutesAt } from './therapy'
import { insulinKind, MEAL_WINDOW_SEC, PREBOLUS_SEC } from './insulinKind'
import { notesBetween } from './notes'
import { targetRange } from './range'
import { minuteOfDayInTz, ymdInTz } from './time'
import { defaultFraction, defaultTotalMin } from './absorption'
import { fpuUnits, fpuHours, FPU_CARB_G } from '#shared/utils/fpu'

/** Ennyi tiszta esemény kell egy napszakban a becsléshez, illetve a megbízható becsléshez. */
export const MIN_EVENTS = 3
export const GOOD_EVENTS = 5
/** A saját zsír-fehérje % becsléséhez ennyi kiértékelhető zsíros étkezés kell a megbízhatóhoz. */
export const FPU_GOOD_EVENTS = 6

const STEP = 5 // perc
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
const DISTURBING_TAGS = ['sport', 'betegseg', 'alkohol']
/** A felszívódási görbe rácsa: percenként 15-ös lépés 0-tól 360-ig. */
export const ABSORB_STEP = 15
export const ABSORB_POINTS = 360 / ABSORB_STEP + 1
export type AbsorbCategory = 'normal' | 'fatty' | 'fast'
/** Ennyi mmol/L teljes szénhidráthatás kell, hogy az étkezés felszívódási görbéje számítható legyen. */
const MIN_CARB_EFFECT = 1.0

interface G { ts: number; v: number }
interface Carb extends G { fatty: boolean; fast: boolean; fat: number | null; protein: number | null }
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
  return t.segments.indexOf(segmentAt(t, ts, true))
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
    if (k.kind !== 'basal') boluses.push({ ts: i.ts, v: i.v, kind: k.kind, noCarbs: k.noCarbs })
  }
  const sample = sampler(sensorGlucose)
  // A beadás napszakának hatásideje bólusonként egyszer számolódik: az időzóna-számítás drága, és a ciklusok
  // (étkezésenként, pontonként, bólusonként) különben milliószor hívnák 90 napnál.
  const diaCache = new Map<number, number>()
  const diaAt = (ts: number) => {
    let v = diaCache.get(ts)
    if (v === undefined) {
      v = t ? actionMinutesAt(t, ts) : 240
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
  const targetAt = (ts: number) => (t ? segmentAt(t, ts).target : 6)
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
    else if (b.noCarbs) groups.push({ ts: b.ts, last: b.ts, carbs: null, fastG: 0, fatty: false, fast: false, boluses: [b], fat: null, protein: null })
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
        const isf = segmentAt(t, g.ts).isf
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
      absorbed: g.carbs ? r2(defaultFraction(endMin / defaultTotalMin(g.fatty ? 'fatty' : g.fast ? 'fast' : 'normal', g.carbs))) : 1,
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
    const best = Math.max(...drops.map((d) => d ?? 0))
    const expected = t ? b.v * segmentAt(t, b.ts).isf : null
    const minDrop = expected != null ? Math.min(MIN_DROP, Math.max(MIN_DROP_FLOOR, MIN_DROP_FRAC * expected)) : MIN_DROP
    if (best < minDrop) continue
    corrections.push({
      ts: b.ts,
      seg: segIndexAt(t, b.ts),
      dose: b.v,
      startBG: r1(startBG),
      drop: r1(best),
      isf: r2(best / b.v),
      perUnit: drops.map((d) => (d == null ? null : r2(d / b.v))),
      ...(truncated ? { truncated: true } : {}),
    })
  }

  // --- Zsíros étkezések zsír / fehérje adattal: mennyit emelt a zsír-fehérje a CH és az inzulin hatásán felül.
  // A végpontban (a várt hatásidő végén, 4–8 óra) a megfigyelt változásból levonjuk a CH teljes hatását
  // (CH × ISF ÷ CH-arány, a napszak beállított értékeivel) és hozzáadjuk a ténylegesen hatott inzulinét (minden bólus,
  // a plusz adag és a korrekció is). Ami marad, az a zsír-fehérje hatása; CH-egyenértékre váltva, egységenként
  // 10 g-hoz (varsói érték) viszonyítva adja a saját %-ot. Kiértékelhető, ha a végpontig nincs más étel, nincs hipó,
  // elég a szenzoradat, és nem gyorsan változó vércukorról indul. A beállított ISF / CH-arányra épül.
  const fpuEvents: FpuEvent[] = []
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
      const s = segmentAt(t, g.ts)
      const acted = bolusesBetween(g.ts - LOOKBACK_SEC, end)
        .filter((b) => b.ts > g.ts - diaAt(b.ts) * 60)
        .reduce((a, b) => a + actedIn(b, g.ts, end), 0)
      effect = vEnd! - startBG - (g.carbs * s.isf) / s.icr + acted * s.isf
      pct = Math.round(((effect * s.icr) / s.isf / (units * FPU_CARB_G)) * 100)
    }
    fpuEvents.push({
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
    })
  }
  const fpuPcts = fpuEvents.filter((e) => e.pct != null).map((e) => e.pct!)
  const fpu = {
    events: [...fpuEvents].reverse(),
    estimate: fpuPcts.length >= MIN_EVENTS
      ? { pct: Math.round(median(fpuPcts)!), n: fpuPcts.length, reliable: fpuPcts.length >= FPU_GOOD_EVENTS }
      : null,
    current: t?.fpuPercent ?? null,
  }

  // --- Napszakonkénti összesítés és becslés.
  const allIcr: number[] = [] // az összes napszak CH-arány értékei az „egész nap” becsléshez
  const allIcrMeals: MealEvent[] = []
  // Bázisellenőrzés (böjti időszakok sodródása), és ebből napszakonként az átlagos sodródás a becslések megbízhatóságához.
  const basal = basalCheck(sensorGlucose, glucose, carbs, boluses, diaAt, low, from, Math.min(to, Math.floor(Date.now() / 1000)))
  const driftOf = (start: string, end: string): number | null => {
    const h0 = Number(start.slice(0, 2))
    const h1 = Number(end.slice(0, 2))
    const span = h1 > h0 ? h1 - h0 : h1 + 24 - h0
    let sum = 0
    let hours = 0
    const days = new Set<string>()
    for (let i = 0; i < span; i++) {
      const x = basal.hours[(h0 + i) % 24]
      if (x.slope == null) continue
      sum += x.slope * x.hours
      hours += x.hours
      for (const d of x.days) days.add(d)
    }
    return hours >= MIN_DRIFT_HOURS && days.size >= MIN_DRIFT_DAYS ? r2(sum / hours) : null
  }

  const segments = segmentGroups(t).map((sg) => {
    const segAll = meals.filter((m) => m.seg === sg.index)
    const segMeals = segAll.filter((m) => !m.fatty)
    const fattyMeals = segAll.filter((m) => m.fatty)
    // A zsíros / fehérjedús étkezések kimaradnak a CH-arány becsléséből (a késői emelkedés torzítana).
    const cleanCarbMeals = segMeals.filter((m) => m.clean && m.carbs && m.bolus > 0 && m.dEnd != null)
    const segCorr = corrections.filter((c) => c.seg === sg.index)

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
        const mealNeeded = m.acted + m.dEnd! / isfForIcr
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
      },
      meals: mealSummary(segMeals),
      fatty: mealSummary(fattyMeals),
      // A CH-arány becsléséhez használt tiszta étkezések görbéje (Terápia oldal).
      clean: mealSummary(usedMeals),
      // A napszak tiszta korrekcióinak mért hatásgörbéje (kevés eseménynél is, tájékoztatásul), a napszak hatásidejével.
      action: actionSummary(segCorr, t, maxDia, sg.seg?.actionMinutes ?? undefined),
      estimate: {
        // Ha az illesztés az inzulin leghosszabb hatásidején akadt meg, más is csökkentette a
        // vércukrot (pl. bázis): az érzékenység és a hatásidő ilyenkor nem megbízható.
        isf: actionFit ? { value: actionFit.isf, n: actionFit.n, unreliable: actionFit.unreliable || drifting } : null,
        icr: icrEst != null ? { value: icrEst, n: icrValues.length, unreliable: icrRising || drifting, rising: risingN } : null,
        action: actionFit ? { ...actionFit, unreliable: actionFit.unreliable || drifting } : null,
        /** A napszak böjti időszakainak átlagos vércukor-változása (mmol/L/óra), ha van rá elég adat. */
        drift,
        drifting,
      },
    }
  })

  // Egész nap (összevont) becslés: ha napszakonként kevés az esemény, de összesen elég, ez tájékoztatásul szolgál.
  // Az érzékenység és a hatásidő a mért eseményekből jön (napszaktól függetlenül); a CH-arány az étkezéseket a saját
  // napszakuk beállított érzékenységével számolja, majd a mediánt veszi.
  const overallFit = corrections.length >= MIN_EVENTS ? fitAction(corrections, maxDia) : null
  const overallRising = allIcrMeals.filter((m) => (m.endRise ?? 0) > ICR_RISING).length
  const overall = {
    counts: { cleanCorrections: corrections.length, cleanMeals: allIcr.length },
    estimate: {
      isf: overallFit ? { value: overallFit.isf, n: overallFit.n, unreliable: overallFit.unreliable } : null,
      icr: allIcr.length >= MIN_EVENTS ? { value: r1(median(allIcr)!), n: allIcr.length, unreliable: overallRising * 2 >= allIcrMeals.length, rising: overallRising } : null,
      action: overallFit,
    },
  }

  return {
    therapySet: !!t,
    overall,
    coverage: glucoseCoverage(sensorGlucose, from, Math.min(to, Math.floor(Date.now() / 1000))),
    counts: { meals: meals.length, corrections: correctionCount, cleanCorrections: corrections.length },
    segments,
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

/** Az étkezésenkénti arányok pontonkénti mediánja, monoton növekvővé téve (a zaj miatt). */
function absorptionProfile(items: { frac: (number | null)[]; grams: number }[]): AbsorptionProfile {
  const samples = items.map((x) => x.frac)
  const n = samples.length
  const empty: AbsorptionProfile = { n, usable: false, profile: null, refGrams: null, t10: null, t50: null, t90: null }
  if (n < MIN_EVENTS) return empty
  const med: (number | null)[] = []
  for (let i = 0; i < ABSORB_POINTS; i++) {
    const vals = samples.map((x) => x[i]).filter((v): v is number => v != null)
    med.push(vals.length >= 2 ? median(vals) : null)
  }
  const lastIdx = med.findLastIndex((v) => v != null)
  if (lastIdx < 4) return empty
  const prof: number[] = []
  let run = 0
  for (let i = 0; i < ABSORB_POINTS; i++) {
    run = Math.max(run, i === 0 ? 0 : i > lastIdx ? 1 : (med[i] ?? run))
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
  return { n, usable: true, profile: norm.map(r2), refGrams: Math.round(median(items.map((x) => x.grams))!), t10: when(0.1), t50: when(0.5), t90: when(0.9) }
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
function medianCurve(events: CorrectionEvent[]): (number | null)[] {
  const need = Math.min(events.length, Math.max(MIN_EVENTS, Math.ceil(events.length / 2)))
  return events[0].perUnit.map((_, i) => {
    const v = events
      .filter((e) => e.perUnit[i] != null)
      .map((e) => ({ v: e.perUnit[i]!, w: e.dose }))
    return v.length >= need ? weightedMedian(v) : null
  })
}

/** Súlyozott medián: az az érték, amelynél a kisebb értékek összsúlya eléri a teljes súly felét (két érték között félúton, ha pontosan ott van a határ). */
function weightedMedian(items: { v: number; w: number }[]): number | null {
  const xs = items.filter((x) => x.w > 0).sort((a, b) => a.v - b.v)
  if (!xs.length) return null
  const half = xs.reduce((a, x) => a + x.w, 0) / 2
  let acc = 0
  for (let i = 0; i < xs.length; i++) {
    acc += xs[i].w
    if (Math.abs(acc - half) < 1e-9 && i + 1 < xs.length) return (xs[i].v + xs[i + 1].v) / 2
    if (acc > half) return xs[i].v
  }
  return xs[xs.length - 1].v
}

/**
 * A mért esési görbékhez illesztett exponenciális modell rácskereséssel. Minden (csúcsidő,
 * hatásidő) párra a teljes esés nagysága (= ISF, mmol/L/E) zárt alakban adódik a legkisebb
 * négyzetek módszerével: medián esés(t) ≈ ISF × (1 − IOB(t)). A legkisebb eltérésű pár nyer.
 */
function fitAction(events: CorrectionEvent[], maxDia: number) {
  const med = medianCurve(events)
  let best: { peak: number; dia: number; isf: number; err: number } | null = null
  // A határ nélküli (2 órával tovább engedett) legjobb illesztés csak annak eldöntésére kell, hogy a
  // vércukor a határon túl is esett-e.
  let free: { dia: number; err: number } | null = null
  // A hatásidő legfeljebb az inzulin alkalmazási előírás szerinti leghosszabb hatásideje lehet.
  for (let dia = 120; dia <= maxDia + 120; dia += 15) {
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
      if (A <= 0) continue
      if (!free || rmse < free.err) free = { dia, err: rmse }
      if (dia <= maxDia && (!best || rmse < best.err)) best = { peak, dia, isf: A, err: rmse }
    }
  }
  // atLimit: határ nélkül hosszabb hatásidő illene jobban, vagyis a vércukor a határon túl is esett.
  const atLimit = !!free && free.dia > maxDia
  // A görbe tényleges (elég eseménnyel alátámasztott) hossza: ha rövidebb a hatásidőnél, a hatásidő és az ISF
  // sem eldönthető belőle.
  const last = med.findLastIndex((v) => v != null)
  const spanMin = last < 0 ? 0 : last * STEP
  const short = !!best && spanMin < best.dia - 30
  return best && {
    peak: best.peak, dia: best.dia, isf: r1(best.isf), rmse: r2(best.err), n: events.length, maxDia, atLimit,
    spanMin, short, unreliable: atLimit || short,
  }
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

/**
 * Bázisellenőrzés: azokban az időszakokban, amikor étel és bólus nem befolyásolja a vércukrot
 * (4 óráig étkezés után — zsírosnál 6 —, a bólus hatásidején belül, és 2 órával hipó után nem),
 * mennyit változik a vércukor óránként. Ha a bázis jól fedi az alapigényt, ez közel nulla.
 * Eredmény: napóránkénti átlagos sodródás (mmol/L/óra) és három napszak-összesítés.
 */
function basalCheck(
  sensorGlucose: G[], glucose: G[], carbs: Carb[], boluses: Bolus[], diaAt: (ts: number) => number, low: number, from: number, to: number,
) {
  const sample = sampler(sensorGlucose)
  // A „nem böjt” időszakok (étkezés, ható bólus, hipó utáni 2 óra) összefésülve, majd 5 perces
  // rácson egyetlen végigsöpréssel jelöljük, mely időpontok számítanak.
  const blocked: [number, number][] = [
    ...carbs.map((c): [number, number] => [c.ts, c.ts + (c.fatty ? FATTY_WINDOW_MIN : c.fast ? FAST_WINDOW_MIN : MEAL_WINDOW_MIN) * 60]),
    ...boluses.map((b): [number, number] => [b.ts, b.ts + diaAt(b.ts) * 60]),
    ...glucose.filter((g) => g.v < low).map((g): [number, number] => [g.ts, g.ts + 2 * 3600]),
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

  const hours = Array.from({ length: 24 }, () => ({ sum: 0, n: 0, days: new Set<string>() }))
  const blockDays: Set<string>[] = [new Set(), new Set(), new Set(), new Set()]
  const blockOf = (h: number) => (h < 4 ? 0 : h < 8 ? 1 : h < 12 ? 2 : 3)
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
    blockDays[blockOf(h)].add(ymdInTz(ts))
  }
  const BLOCKS = [
    { label: 'Éjszaka', from: 0, to: 4 },
    { label: 'Hajnal, kora reggel', from: 4, to: 8 },
    { label: 'Délelőtt', from: 8, to: 12 },
    { label: 'Délután, este', from: 12, to: 24 },
  ]
  return {
    hours: hours.map((x, h) => ({ h, slope: x.n ? r2(x.sum / x.n) : null, hours: r1((x.n * 5) / 60), days: [...x.days] })),
    blocks: BLOCKS.map((b, i) => {
      const hs = hours.slice(b.from, b.to)
      const n = hs.reduce((a, x) => a + x.n, 0)
      return {
        ...b,
        slope: n ? r2(hs.reduce((a, x) => a + x.sum, 0) / n) : null,
        hours: r1((n * 5) / 60),
        days: blockDays[i].size,
      }
    }),
  }
}
