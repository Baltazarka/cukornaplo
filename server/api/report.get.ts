// Nyomtatható riport napi részletei: minden napra a glükózgörbe, a napi mutatók és az összes
// bejegyzés (bólus / korrekció / bázis, szénhidrát). ?end=YYYY-MM-DD&days=7|14|30
import { db } from '../utils/db'
import { glucoseStats } from '../utils/stats'
import { targetRange } from '../utils/range'
import { startOfDayTs, todayYmd, addDaysYmd, huWeekday, hmInTz, minuteOfDayInTz, ymdInTz } from '../utils/time'
import { insulinKind, MEAL_WINDOW_SEC, PREBOLUS_SEC } from '../utils/insulinKind'
import { changeTime } from '../utils/trend'
import { notesBetween } from '../utils/notes'

const PERIODS = [7, 14, 30]

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const days = PERIODS.includes(Number(q.days)) ? Number(q.days) : 14
  const { low, high } = targetRange()
  const today = todayYmd()
  let end = typeof q.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.end) ? q.end : today
  if (end > today) end = today
  const start = addDaysYmd(end, -(days - 1))
  const from = startOfDayTs(start)
  const to = startOfDayTs(addDaysYmd(end, 1))

  const rows = db()
    .prepare('SELECT type, ts, value, subtype, source FROM entries WHERE ts >= ? AND ts < ? ORDER BY ts')
    .all(from - MEAL_WINDOW_SEC, to + PREBOLUS_SEC) as { type: string; ts: number; value: number; subtype: string | null; source: string | null }[]
  const carbTs = rows.filter((r) => r.type === 'carbs').map((r) => Number(r.ts))

  type Day = {
    date: string; label: string; weekday: string
    glucose: [number, number][]
    /** A glükózpontok időpontja (unix mp), a `glucose` sorrendjében: a párosításhoz (óraátállításkor a perc kétértelmű). */
    gts: number[]
    sensorN: number
    events: { ts: number; time: string; minute: number; type: 'insulin' | 'carbs'; kind: string | null; v: number; fatty: boolean; fast: boolean; glucose: number | null }[]
  }
  const byDay = new Map<string, Day>()
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) {
    byDay.set(d, { date: d, label: d.replaceAll('-', '. ') + '.', weekday: huWeekday(d), glucose: [], gts: [], sensorN: 0, events: [] })
  }
  const allGlucose: { ts: number; v: number }[] = []
  for (const r of rows) {
    const ts = Number(r.ts)
    if (ts < from || ts >= to) continue
    const day = byDay.get(ymdInTz(ts))
    if (!day) continue
    const v = Number(r.value)
    const minute = minuteOfDayInTz(ts)
    if (r.type === 'glucose') {
      day.glucose.push([minute, v])
      day.gts.push(ts)
      if (r.source !== 'manual') {
        day.sensorN++
        allGlucose.push({ ts, v }) // a változás sebességéhez csak szenzoradat
      }
    } else {
      const kind = r.type === 'insulin' ? insulinKind(ts, r.subtype, carbTs, Number(r.value)) : null
      day.events.push({
        ts, time: hmInTz(ts), minute, type: r.type as 'insulin' | 'carbs',
        kind: kind ? (kind.kind === 'meal' && kind.noCarbs ? 'meal-nocarb' : kind.kind) : null,
        v, fatty: r.type === 'carbs' && r.subtype === 'fatty', fast: r.type === 'carbs' && r.subtype === 'fast', glucose: null,
      })
    }
  }

  const notes = notesBetween(from, to)
  const out = [...byDay.values()].map(({ gts, ...d }) => {
    // A bejegyzések mellé a legközelebbi (±10 perc) glükózérték, időpont szerint párosítva.
    for (const e of d.events) {
      let best: number | null = null
      let diff = 11 * 60
      d.glucose.forEach(([, v], i) => {
        const dt = Math.abs(gts[i] - e.ts)
        if (dt < diff) { diff = dt; best = v }
      })
      e.glucose = best
    }
    const stats = glucoseStats(d.glucose.map((g) => g[1]), low, high)
    const sum = (pred: (e: Day['events'][number]) => boolean) => d.events.filter(pred).reduce((a, e) => a + e.v, 0)
    return {
      ...d,
      notes: notes.filter((n) => n.day === d.date).map((n) => ({ time: n.time, minute: n.minute, tags: n.tags, text: n.text })),
      stats,
      coverage: coverageOf(d.date, d.sensorN),
      totals: {
        // A beadás időpontja szerint, csak a naplózott adagok (becsült bázis nélkül).
        meal: sum((e) => e.kind === 'meal' || e.kind === 'meal-nocarb'),
        correction: sum((e) => e.kind === 'correction'),
        basal: sum((e) => e.kind === 'basal'),
        carbs: sum((e) => e.type === 'carbs'),
      },
    }
  })

  return {
    days, start, end, today,
    generatedAt: Math.floor(Date.now() / 1000),
    range: { low, high },
    change: changeTime(allGlucose),
    dayList: out.reverse(), // a legfrissebb nap elöl
  }
})

/** Szenzorlefedettség egy napra: a mérések száma az eltelt időhöz képest (ma csak a mostanáig). */
function coverageOf(date: string, n: number): number {
  const from = startOfDayTs(date)
  const elapsed = Math.min(startOfDayTs(addDaysYmd(date, 1)), Math.floor(Date.now() / 1000)) - from
  return elapsed > 0 ? Math.min(100, Math.round((100 * n) / (elapsed / 300))) : 0
}
