// Az előrejelzés pontossága visszatesztelve a saját adataidon: az elmúlt napokban fél óránként kiszámolja,
// mit jósolt volna 15 / 30 / 60 percre, és összeveti a ténylegesen mért szenzorértékkel (átlagos abszolút hiba, mmol/L).
// Három módszer: változatlan érték (összehasonlítási alap), modell + lendület (régi), keverés (xDrip+-szerű, alap).
// Megjegyzés: a tanult felszívódási görbe az egész időszak étkezéseiből készült, ezért a teszt enyhén optimista.
import { predictValue, type PredictMode } from '../utils/predict'
import { glucosePoints } from '../utils/digest'

const HORIZONS = [15, 30, 60]
const MODES: PredictMode[] = ['residual', 'blend']

export default defineEventHandler((event) => {
  const q = Number(getQuery(event).days)
  const days = [7, 14, 30].includes(q) ? q : 14
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

  const acc: Record<string, { n: number; base: number; residual: number; blend: number; lowHit: Record<string, number> }> = {}
  for (const h of HORIZONS) acc[h] = { n: 0, base: 0, residual: 0, blend: 0, lowHit: {} }

  // 30 percenként mintavétel, az utolsó 2 óra kimarad (ott még nincs mért „jövő”).
  for (let t = from; t <= now - 2 * 3600; t += 1800) {
    const cur = near(t)
    if (cur == null) continue
    for (const h of HORIZONS) {
      const actual = near(t + h * 60)
      if (actual == null) continue
      const preds: Partial<Record<PredictMode, number>> = {}
      let latestV: number | null = null
      for (const m of MODES) {
        const r = predictValue(h, t, m)
        if (!r || t - r.latest.ts > 600) { latestV = null; break }
        preds[m] = r.v
        latestV = r.latest.v
      }
      if (latestV == null || preds.residual == null || preds.blend == null) continue
      const a = acc[h]
      a.n++
      a.base += Math.abs(latestV - actual)
      a.residual += Math.abs(preds.residual - actual)
      a.blend += Math.abs(preds.blend - actual)
    }
  }
  const r2 = (x: number) => Math.round(x * 100) / 100
  return {
    days,
    horizons: HORIZONS.map((h) => {
      const a = acc[h]
      return {
        minutes: h,
        n: a.n,
        persistence: a.n ? r2(a.base / a.n) : null,
        residual: a.n ? r2(a.residual / a.n) : null,
        blend: a.n ? r2(a.blend / a.n) : null,
      }
    }),
  }
})
