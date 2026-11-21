// Az elemzés tiszta számoló részei (nincs adatbázis, beállítás vagy óra: tests/analysis.test.ts): mediánok, monoton
// illesztés, az inzulinhatás-modell illesztése a mért esési görbékhez és a zajmentes mélypont.
import { insulinModel } from '../../shared/utils/insulins.ts'

/** Ennyi tiszta esemény kell egy napszakban a becsléshez, illetve a megbízható becsléshez. */
export const MIN_EVENTS = 3
/** A görbék időlépése, perc. */
export const STEP = 5

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

/** Egy korrekció esési görbéje egységre vetítve (mmol/L / E, 5 percenként) és az adag. */
export interface CurveEvent {
  dose: number
  perUnit: (number | null)[]
}

/**
 * A korrekció mélypontja: a legnagyobb esés, de a három szomszédos pont mediánjával, hogy egy zajos szenzorérték ne
 * mélyítse a becslést (a szenzor ±0,3 mmol/L-t is ingadozik; a legnagyobb egyedi pont az ISF-et felfelé torzítaná).
 * A hiányzó pontok kimaradnak; 0, ha nincs adat.
 */
export function nadirDrop(drops: (number | null)[]): number {
  let best = 0
  for (let i = 0; i < drops.length; i++) {
    if (drops[i] == null) continue
    const near = [drops[i - 1], drops[i], drops[i + 1]].filter((d): d is number => d != null)
    const m = median(near)!
    if (m > best) best = m
  }
  return best
}

export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
export function median(values: number[]): number | null {
  return values.length ? quantile([...values].sort((a, b) => a - b), 0.5) : null
}

/**
 * Monoton növekvő illesztés (izotonikus regresszió, PAV): a futó maximummal szemben a zaj nem húzza felfelé a görbét.
 * `y`: pontonkénti érték (null = nincs adat), `w`: súly (hány étkezésből).
 */
export function isotonic(y: (number | null)[], w: number[]): (number | null)[] {
  const blocks: { v: number; w: number; idx: number[] }[] = []
  y.forEach((v, i) => {
    if (v == null) return
    blocks.push({ v, w: w[i], idx: [i] })
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const b = blocks.pop()!
      const a = blocks[blocks.length - 1]
      a.v = (a.v * a.w + b.v * b.w) / (a.w + b.w)
      a.w += b.w
      a.idx.push(...b.idx)
    }
  })
  const out: (number | null)[] = y.map(() => null)
  for (const b of blocks) for (const i of b.idx) out[i] = b.v
  return out
}

function medianCurve(events: CurveEvent[]): (number | null)[] {
  const need = Math.min(events.length, Math.max(MIN_EVENTS, Math.ceil(events.length / 2)))
  return events[0].perUnit.map((_, i) => {
    const v = events
      .filter((e) => e.perUnit[i] != null)
      .map((e) => ({ v: e.perUnit[i]!, w: e.dose }))
    return v.length >= need ? weightedMedian(v) : null
  })
}

/** Súlyozott medián: az az érték, amelynél a kisebb értékek összsúlya eléri a teljes súly felét (két érték között félúton, ha pontosan ott van a határ). */
export function weightedMedian(items: { v: number; w: number }[]): number | null {
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
export function fitAction(events: CurveEvent[], maxDia: number) {
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
  // Csak ha a határ nélküli illesztés érdemben (legalább 10%-kal kisebb eltéréssel) jobb: zajnál a pontosan a határon lévő
  // valódi hatásidő is „hosszabbnak” látszana.
  const atLimit = !!free && free.dia > maxDia && (!best || free.err < best.err * 0.9)
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
