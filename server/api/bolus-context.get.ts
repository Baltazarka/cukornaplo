// A bóluskalkulátor kiinduló adatai most: a legutóbbi CGM-érték és trendje, a most érvényes
// napszak beállításai, a még aktív gyors hatású inzulin és a maximális dózis.
import { db } from '../utils/db'
import { therapy, activeSegments, segmentAt } from '../utils/therapy'
import { targetRange } from '../utils/range'
import { lastTrend } from '../utils/trend'
import { rapidDoses, iobAt } from '../utils/iob'
import { minuteOfDayInTz } from '../utils/time'

export default defineEventHandler(() => {
  const now = Math.floor(Date.now() / 1000)
  const t = therapy()
  const { low, high } = targetRange()

  const recent = (db()
    .prepare("SELECT ts, value FROM entries WHERE type = 'glucose' AND ts >= ? ORDER BY ts")
    .all(now - 3600) as any[]).map((r) => ({ ts: Number(r.ts), v: Number(r.value) }))
  const last = recent.at(-1)
  const glucose = last
    ? { v: last.v, ts: last.ts, ageMin: Math.max(0, Math.round((now - last.ts) / 60)), trend: lastTrend(recent) }
    : null

  if (!t) return { therapySet: false, now, glucose, range: { low, high } }

  const seg = segmentAt(t, now)
  const segs = activeSegments(t)
  const idx = segs.indexOf(seg)
  const carbTs = (db().prepare("SELECT ts FROM entries WHERE type = 'carbs' AND ts >= ?").all(now - 12 * 3600) as any[]).map((r) => Number(r.ts))
  const doses = rapidDoses(t, now, now + 1, carbTs)
  const lastDose = doses.at(-1)

  // Átmenet a napszakok között: a CH-arány és az érzékenység a napszak kezdetén a beállított érték,
  // onnan a következő napszak kezdetéig arányosan (lineárisan) halad a következő értékéig.
  // Pl. 06:00-kor 2 g/E, 12:00-kor 4 g/E → 09:00-kor 3 g/E. Az utolsó napszak éjfélen át az elsőig tart.
  let blend = null
  if (segs.length > 1 && idx >= 0) {
    const next = segs[(idx + 1) % segs.length]
    const hm = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5))
    const len = (hm(next.start) - hm(seg.start) + 1440) % 1440 || 1440
    const frac = ((minuteOfDayInTz(now) - hm(seg.start) + 1440) % 1440) / len
    const mix = (a: number, b: number) => Math.round((a + (b - a) * frac) * 100) / 100
    blend = {
      frac: Math.round(frac * 100) / 100,
      icr: mix(seg.icr, next.icr),
      isf: mix(seg.isf, next.isf),
      next: { start: next.start, icr: next.icr, isf: next.isf },
    }
  }

  return {
    therapySet: true,
    now,
    glucose,
    range: { low, high },
    segment: {
      start: seg.start,
      end: segs[(idx + 1) % segs.length].start,
      target: seg.target,
      isf: seg.isf,
      icr: seg.icr,
    },
    blend,
    iob: Math.round(iobAt(doses, now) * 100) / 100,
    lastBolus: lastDose ? { v: lastDose.v, minutesAgo: Math.round((now - lastDose.ts) / 60) } : null,
    maxBolus: t.maxBolus,
    insulin: insulinById(t.bolusInsulin)?.name ?? null,
  }
})
