// Az előrejelzés pontossága visszatesztelve a saját adataidon: az elmúlt napokban fél óránként kiszámolja,
// mit jósolt volna 15 / 30 / 60 percre, és összeveti a ténylegesen mért szenzorértékkel (átlagos abszolút hiba, mmol/L).
// Négy módszer: változatlan (összehasonlítási alap), csillapított trend, modell + lendület, keverés. Az eredményt
// külön számolja arra az esetre is, amikor van aktív inzulin / szénhidrát, és amikor nincs. Ebből a 14 napos teszt
// kiválasztja távolságonként és állapotonként a legjobb módszert (az egyszerűbbet, ha nem rosszabb 3%-nál többel).
// Megjegyzés: a tanult felszívódási görbe az egész időszak étkezéseiből készült, ezért a teszt enyhén optimista.
import { predictMany, PREDICT_MODES, CHOICE_KEY, BIAS_KEY, resetPredictChoice, type PredictMode, type PredictChoice, type PredictBias } from './predict'
import { glucosePoints } from './digest'
import { storeComputed } from './computed'

export const ACC_HORIZONS = [15, 30, 60]
/** A választás alapja ennyi napos teszt. */
export const CHOICE_DAYS = 14
const MIN_SAMPLES = 20
const TOLERANCE = 1.03

type Mae = Record<PredictMode, number | null>
export interface AccuracyRow {
  minutes: number
  n: number
  mae: Mae
  /** A keverés átlagos eltérése (becsült − mért); negatív: túl alacsonyat jósol. */
  active: { n: number; mae: Mae; blendBias: number | null }
  calm: { n: number; mae: Mae; blendBias: number | null }
}
export interface Accuracy {
  days: number
  horizons: AccuracyRow[]
}

const r2 = (x: number) => Math.round(x * 100) / 100
const emptySums = () => Object.fromEntries(PREDICT_MODES.map((m) => [m, 0])) as Record<PredictMode, number>
const toMae = (sums: Record<PredictMode, number>, n: number): Mae =>
  Object.fromEntries(PREDICT_MODES.map((m) => [m, n ? r2(sums[m] / n) : null])) as Mae

export function computeAccuracy(days: number): Accuracy {
  const now = Math.floor(Date.now() / 1000)
  const from = now - days * 86400
  const sensor = glucosePoints(from - 3600, now + 60).filter((p) => !p.manual)
  const near = (ts: number): number | null => {
    let lo = 0
    let hi = sensor.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sensor[mid].ts < ts) lo = mid + 1
      else hi = mid
    }
    let best: number | null = null
    let bd = 301
    for (const i of [lo - 1, lo, lo + 1]) {
      const p = sensor[i]
      if (p && Math.abs(p.ts - ts) < bd) { bd = Math.abs(p.ts - ts); best = p.v }
    }
    return best
  }

  const acc = ACC_HORIZONS.map(() => ({ n: 0, all: emptySums(), act: { n: 0, s: emptySums(), bias: 0 }, calm: { n: 0, s: emptySums(), bias: 0 } }))
  // 30 percenként mintavétel, az utolsó 2 óra kimarad (ott még nincs mért „jövő”).
  for (let t = from; t <= now - 2 * 3600; t += 1800) {
    if (near(t) == null) continue
    const r = predictMany(t, ACC_HORIZONS, PREDICT_MODES)
    if (!r || t - r.latest.ts > 600) continue
    ACC_HORIZONS.forEach((h, i) => {
      const actual = near(t + h * 60)
      if (actual == null) return
      const a = acc[i]
      const part = r.active ? a.act : a.calm
      a.n++
      part.n++
      part.bias += r.v.blend[h] - actual
      for (const m of PREDICT_MODES) {
        const e = Math.abs(r.v[m][h] - actual)
        a.all[m] += e
        part.s[m] += e
      }
    })
  }
  return {
    days,
    horizons: ACC_HORIZONS.map((h, i) => ({
      minutes: h,
      n: acc[i].n,
      mae: toMae(acc[i].all, acc[i].n),
      active: { n: acc[i].act.n, mae: toMae(acc[i].act.s, acc[i].act.n), blendBias: acc[i].act.n >= MIN_SAMPLES ? r2(acc[i].act.bias / acc[i].act.n) : null },
      calm: { n: acc[i].calm.n, mae: toMae(acc[i].calm.s, acc[i].calm.n), blendBias: acc[i].calm.n >= MIN_SAMPLES ? r2(acc[i].calm.bias / acc[i].calm.n) : null },
    })),
  }
}

/** A legjobb módszer: a legkisebb hibájú, vagy az egyszerűbb, ha legfeljebb 3%-kal rosszabb. Kevés mintánál: alap. */
function pick(mae: Mae, n: number, fallback: PredictMode): PredictMode {
  if (n < MIN_SAMPLES) return fallback
  const have = PREDICT_MODES.filter((m) => mae[m] != null)
  if (!have.length) return fallback
  const best = Math.min(...have.map((m) => mae[m]!))
  return have.find((m) => mae[m]! <= best * TOLERANCE) ?? fallback
}

export function chooseModes(acc: Accuracy): PredictChoice {
  const out = {} as PredictChoice
  for (const row of acc.horizons) {
    const overall = pick(row.mae, row.n, 'trend')
    out[String(row.minutes) as '15' | '30' | '60'] = {
      active: pick(row.active.mae, row.active.n, overall),
      calm: pick(row.calm.mae, row.calm.n, overall),
    }
  }
  return out
}

/** A pontosság számolása; a választás alapjául szolgáló (14 napos) teszt után a választás is frissül. */
export function accuracyJob(days: number): Accuracy {
  const acc = computeAccuracy(days)
  if (days === CHOICE_DAYS) {
    storeComputed(CHOICE_KEY, chooseModes(acc))
    storeComputed(BIAS_KEY, Object.fromEntries(acc.horizons.map((r) => [String(r.minutes), { active: r.active.blendBias, calm: r.calm.blendBias }])) as PredictBias)
    resetPredictChoice()
  }
  return acc
}
