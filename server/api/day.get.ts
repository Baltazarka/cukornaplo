// Napi nézet adatai: glükózgörbe, inzulin, szénhidrát, napi statisztikák és 14 napos összesítő.
import { db } from '../utils/db'
import { glucoseStats, RANGE_LOW, RANGE_HIGH, RANGE_VERY_LOW, RANGE_VERY_HIGH } from '../utils/stats'
import { targetRange } from '../utils/range'
import { hmInTz, startOfDayTs, todayYmd, addDaysYmd, huWeekday } from '../utils/time'
import { groupByDay, summaryRows } from '../utils/summary'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const { low, high } = targetRange()
  const today = todayYmd()
  let day = typeof q.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today
  if (day > today) day = today

  const dayStart = startOfDayTs(day)
  const dayEnd = startOfDayTs(addDaysYmd(day, 1))
  const rangeStart = startOfDayTs(addDaysYmd(day, -13))

  const rows = db()
    .prepare('SELECT id, type, ts, value, subtype, source FROM entries WHERE ts >= ? AND ts < ? ORDER BY ts')
    .all(rangeStart, dayEnd) as any[]

  const dayRows = { glucose: [] as any[], insulin: [] as any[], carbs: [] as any[] }
  const daily = groupByDay(rows)
  const allGlucose: number[] = []

  for (const r of rows) {
    const ts = Number(r.ts)
    const v = Number(r.value)
    if (r.type === 'glucose') allGlucose.push(v)
    if (ts >= dayStart) dayRows[r.type as 'glucose' | 'insulin' | 'carbs'].push({ id: Number(r.id), ts, v, sub: r.subtype, src: r.source })
  }

  const dayStats = glucoseStats(dayRows.glucose.map((g) => g.v), low, high)
  const rangeStats = glucoseStats(allGlucose, low, high)
  const dayInsulin = dayRows.insulin.reduce((a, e) => a + e.v, 0)
  const dayCarbs = dayRows.carbs.reduce((a, e) => a + e.v, 0)
  const coverage = dayStats.n ? Math.min(100, (100 * dayStats.n) / 288) : 0

  // Napló: inzulin + CH időrendben, mellé a legközelebbi (±10 perc) glükózérték.
  const events = [
    ...dayRows.insulin.map((e) => ({ ...e, type: 'insulin' as const })),
    ...dayRows.carbs.map((e) => ({ ...e, type: 'carbs' as const })),
  ].sort((a, b) => a.ts - b.ts || a.type.localeCompare(b.type))
  const nearestGlucose = (ts: number): number | null => {
    let best: number | null = null
    let bestDiff = 601
    for (const g of dayRows.glucose) {
      const d = Math.abs(g.ts - ts)
      if (d < bestDiff) { best = g.v; bestDiff = d }
    }
    return best
  }

  const summary = summaryRows(daily, day, 14, low, high)

  return {
    day,
    today,
    prev: addDaysYmd(day, -1),
    next: addDaysYmd(day, 1),
    label: day.replaceAll('-', '. ') + '., ' + huWeekday(day),
    basalDose: setting('basal_dose', null) === null ? null : Number(setting('basal_dose')),
    dayStartMs: dayStart * 1000,
    dayEndMs: dayEnd * 1000,
    range: { veryLow: RANGE_VERY_LOW, low, high, veryHigh: RANGE_VERY_HIGH },
    glucose: dayRows.glucose.map((g) => [g.ts * 1000, g.v]),
    insulin: dayRows.insulin.map((e) => [e.ts * 1000, e.v, e.sub]),
    carbs: dayRows.carbs.map((e) => [e.ts * 1000, e.v]),
    events: events.map((e) => ({
      id: e.id, ts: e.ts * 1000, time: hmInTz(e.ts), type: e.type, sub: e.sub ?? null, v: e.v, glucose: nearestGlucose(e.ts),
    })),
    stats: { day: dayStats, range14: rangeStats },
    totals: { insulin: dayInsulin, carbs: dayCarbs },
    coverage,
    summary,
  }
})
