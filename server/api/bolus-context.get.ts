// A bóluskalkulátor kiinduló adatai most: a legutóbbi CGM-érték és trendje, a most érvényes
// napszak beállításai, a még aktív gyors hatású inzulin és a maximális dózis.
import { db } from '../utils/db'
import { therapy, activeSegments, segmentAt, blendAt, DEFAULT_FPU_PERCENT } from '../utils/therapy'
import { targetRange } from '../utils/range'
import { lastTrend } from '../utils/trend'
import { rapidDoses, iobAt } from '../utils/iob'
import { recentFpu } from '../utils/fpuRecent'

export default defineEventHandler(() => {
  const now = Math.floor(Date.now() / 1000)
  const t = therapy()
  const { low, high } = targetRange()

  // A legutóbbi érték: szenzor vagy kézi mérés (amelyik újabb). A trend csak a szenzoradatból számolódik.
  const all = (db()
    .prepare("SELECT ts, value, source FROM entries WHERE type = 'glucose' AND ts >= ? ORDER BY ts")
    .all(now - 3600) as any[]).map((r) => ({ ts: Number(r.ts), v: Number(r.value), manual: r.source === 'manual' }))
  const recent = all.filter((p) => !p.manual)
  const last = all.at(-1)
  const glucose = last
    ? {
        v: last.v, ts: last.ts, ageMin: Math.max(0, Math.round((now - last.ts) / 60)), manual: last.manual,
        trend: last.manual ? null : lastTrend(recent),
      }
    : null

  if (!t) return { therapySet: false, now, glucose, range: { low, high } }

  const seg = segmentAt(t, now)
  const segs = activeSegments(t)
  const idx = segs.indexOf(seg)
  const carbTs = (db().prepare("SELECT ts FROM entries WHERE type = 'carbs' AND ts >= ?").all(now - 12 * 3600) as any[]).map((r) => Number(r.ts))
  const doses = rapidDoses(t, now, now + 1, carbTs)
  const lastDose = doses.at(-1)

  // Átmenet a napszakok között (blendAt): a kalkulátor alapból ezzel számol.
  const b = blendAt(t, now)
  const blend = b ? { frac: b.frac, icr: b.icr, isf: b.isf, next: { start: b.next.start, icr: b.next.icr, isf: b.next.isf } } : null

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
    fpuPercent: t.fpuPercent ?? DEFAULT_FPU_PERCENT,
    fpuTiming: t.fpuTiming ?? 'later',
    // 5 órán belüli zsíros étkezés zsír-fehérje javaslattal: a korrekció ezzel átfed (figyelmeztetés a kalkulátorban).
    recentFpu: recentFpu(now),
    insulin: insulinById(t.bolusInsulin)?.name ?? null,
  }
})
