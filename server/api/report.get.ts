// Nyomtatható riport napi részletei: minden napra a glükózgörbe, a napi mutatók és az összes
// bejegyzés (bólus / korrekció / bázis, szénhidrát). ?end=YYYY-MM-DD&days=7|14|30
import { db } from '../utils/db'
import { glucoseStats } from '../utils/stats'
import { targetRange } from '../utils/range'
import { startOfDayTs, todayYmd, addDaysYmd, huWeekday, hmInTz, minuteOfDayInTz, ymdInTz } from '../utils/time'
import { insulinKind, MEAL_WINDOW_SEC, PREBOLUS_SEC } from '../utils/insulinKind'
import { bolusByDay } from '../utils/dailyInsulin'
import { changeTime } from '../utils/trend'
import { notesBetween } from '../utils/notes'
import { assumedBasalDose } from '../utils/basal'

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
    sensorN: number
    events: { time: string; minute: number; type: 'insulin' | 'carbs'; kind: string | null; v: number; fatty: boolean; fast: boolean; glucose: number | null }[]
  }
  const byDay = new Map<string, Day>()
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) {
    byDay.set(d, { date: d, label: d.replaceAll('-', '. ') + '.', weekday: huWeekday(d), glucose: [], sensorN: 0, events: [] })
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
      if (r.source !== 'manual') {
        day.sensorN++
        allGlucose.push({ ts, v }) // a változás sebességéhez csak szenzoradat
      }
    } else {
      const kind = r.type === 'insulin' ? insulinKind(ts, r.subtype, carbTs) : null
      day.events.push({
        time: hmInTz(ts), minute, type: r.type as 'insulin' | 'carbs',
        kind: kind ? (kind.kind === 'meal' && kind.noCarbs ? 'meal-nocarb' : kind.kind) : null,
        v, fatty: r.type === 'carbs' && r.subtype === 'fatty', fast: r.type === 'carbs' && r.subtype === 'fast', glucose: null,
      })
    }
  }

  const notes = notesBetween(from, to)
  const basalDose = assumedBasalDose()
  // A bólus a hatás szerint oszlik meg a napok között (az éjfél körül beadott adag fennmaradó része a következő napé).
  const alloc = bolusByDay(start, end)
  const out = [...byDay.values()].map((d) => {
    // A bejegyzések mellé a legközelebbi (±10 perc) glükózérték.
    for (const e of d.events) {
      let best: number | null = null
      let diff = 11
      for (const [m, v] of d.glucose) {
        if (Math.abs(m - e.minute) < diff) { diff = Math.abs(m - e.minute); best = v }
      }
      e.glucose = best
    }
    const stats = glucoseStats(d.glucose.map((g) => g[1]), low, high)
    const sum = (pred: (e: Day['events'][number]) => boolean) => d.events.filter(pred).reduce((a, e) => a + e.v, 0)
    // Lezárt nap InPen-adattal, de bázis nélkül: a beállított bázisadag (becsült).
    const basalAssumed = basalDose != null && d.date < today && sum((e) => e.kind === 'basal') === 0 && d.events.some((e) => e.type === 'insulin')
    return {
      ...d,
      notes: notes.filter((n) => n.day === d.date).map((n) => ({ time: n.time, minute: n.minute, tags: n.tags, text: n.text })),
      stats,
      coverage: coverageOf(d.date, d.sensorN),
      totals: {
        meal: alloc ? alloc[d.date].meal : sum((e) => e.kind === 'meal' || e.kind === 'meal-nocarb'),
        correction: alloc ? alloc[d.date].correction : sum((e) => e.kind === 'correction'),
        basal: basalAssumed ? basalDose! : sum((e) => e.kind === 'basal'),
        basalAssumed,
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
