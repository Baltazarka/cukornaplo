// Nyomtatható riport napi részletei: minden napra a glükózgörbe, a napi mutatók és az összes
// bejegyzés (bólus / korrekció / bázis, szénhidrát). ?end=YYYY-MM-DD&days=7|14|30
import { db } from '../utils/db'
import { glucoseStats } from '../utils/stats'
import { targetRange } from '../utils/range'
import { startOfDayTs, todayYmd, addDaysYmd, huWeekday, hmInTz, minuteOfDayInTz, ymdInTz } from '../utils/time'
import { insulinKind, MEAL_WINDOW_SEC, PREBOLUS_SEC } from '../utils/insulinKind'
import { changeTime } from '../utils/trend'
import { notesBetween } from '../utils/notes'
import { excludedBetween } from '../utils/excluded'
import { shiftOn } from '../utils/therapy'

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
    .prepare('SELECT type, ts, value, subtype, source FROM entries WHERE ts >= ? AND ts < ? AND excluded = 0 ORDER BY ts')
    .all(from - MEAL_WINDOW_SEC, to + PREBOLUS_SEC) as { type: string; ts: number; value: number; subtype: string | null; source: string | null }[]
  const carbTs = rows.filter((r) => r.type === 'carbs').map((r) => Number(r.ts))

  type Day = {
    date: string; label: string; weekday: string
    /** Váltott műszak: a nap műszakja, ha van beosztás. */
    shift: string | null
    /** Szenzorgörbe: [perc, mmol/L]. */
    glucose: [number, number][]
    /** A glükózpontok időpontja (unix mp), a `glucose` sorrendjében: a párosításhoz (óraátállításkor a perc kétértelmű). */
    gts: number[]
    /** Kézi (ujjbegyes) mérések: a statisztikába beleszámítanak, a grafikonon külön pontként (nem a görbében). */
    manual: [number, number][]
    mts: number[]
    sensorN: number
    events: { ts: number; time: string; minute: number; type: 'insulin' | 'carbs'; kind: string | null; v: number; fatty: boolean; fast: boolean; glucose: number | null }[]
    /** Kizárt szenzorértékek (pl. ráfekvés): [perc, mmol/L], a grafikonon szürkén. */
    excludedGlucose: [number, number][]
    /** Kizárt szakaszok: a naplóban szürke sor, a szakasz előtti / utáni érvényes méréssel. */
    excluded: { minute: number; toMinute: number; time: string; n: number; lo: number | null; loTime: string | null; hi: number | null; before: number | null; after: number | null }[]
  }
  const byDay = new Map<string, Day>()
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) {
    byDay.set(d, { date: d, label: d.replaceAll('-', '. ') + '.', weekday: huWeekday(d), shift: shiftOn(d), glucose: [], gts: [], manual: [], mts: [], sensorN: 0, events: [], excludedGlucose: [], excluded: [] })
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
      if (r.source === 'manual') {
        day.manual.push([minute, v])
        day.mts.push(ts)
      } else {
        day.glucose.push([minute, v])
        day.gts.push(ts)
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
  // Kizárt szenzorszakaszok (a fenti lekérdezés ezeket kihagyja): külön, szürkén mutatjuk őket.
  const exRows = (db()
    .prepare("SELECT ts, value FROM entries WHERE type = 'glucose' AND excluded = 1 AND ts >= ? AND ts < ? ORDER BY ts")
    .all(from, to) as { ts: number; value: number }[]).map((r) => ({ ts: Number(r.ts), v: Number(r.value) }))
  for (const r of exRows) byDay.get(ymdInTz(r.ts))?.excludedGlucose.push([minuteOfDayInTz(r.ts), r.v])
  for (const x of excludedBetween(from, to)) {
    const day = byDay.get(ymdInTz(Math.max(x.from, from)))
    if (!day) continue
    const vals = exRows.filter((r) => r.ts >= x.from && r.ts <= x.to)
    const lo = vals.length ? vals.reduce((a, r) => (r.v < a.v ? r : a)) : null
    const hi = vals.length ? vals.reduce((a, r) => (r.v > a.v ? r : a)) : null
    const before = [...allGlucose].reverse().find((g) => g.ts < x.from)
    const after = allGlucose.find((g) => g.ts > x.to)
    day.excluded.push({
      minute: minuteOfDayInTz(Math.max(x.from, from)), toMinute: ymdInTz(x.to) === day.date ? minuteOfDayInTz(x.to) : 1440,
      time: `${hmInTz(x.from)}–${hmInTz(x.to)}`, n: vals.length,
      lo: lo?.v ?? null, loTime: lo ? hmInTz(lo.ts) : null, hi: hi?.v ?? null,
      before: before && x.from - before.ts <= 3600 ? before.v : null, after: after && after.ts - x.to <= 3600 ? after.v : null,
    })
  }

  const out = [...byDay.values()].map(({ gts, mts, ...d }) => {
    // A bejegyzések mellé a legközelebbi (±10 perc) glükózérték (szenzor vagy kézi mérés), időpont szerint párosítva.
    for (const e of d.events) {
      let best: number | null = null
      let diff = 11 * 60
      const near = (list: [number, number][], tss: number[]) => list.forEach(([, v], i) => {
        const dt = Math.abs(tss[i] - e.ts)
        if (dt < diff) { diff = dt; best = v }
      })
      near(d.glucose, gts)
      near(d.manual, mts)
      e.glucose = best
    }
    const stats = glucoseStats([...d.glucose, ...d.manual].map((g) => g[1]), low, high)
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

  // Műszak szerinti napi profil: 30 percenként az átlagos glükóz a délelőttös és a délutános napokon
  // (szabadnap és beosztás nélküli nap kimarad; csak a legalább félnapnyi szenzoradatos napok).
  const PROFILE_BIN = 30
  const profileBins = 1440 / PROFILE_BIN
  const shiftProfile: { minutes: number[]; days: Record<string, number>; stats: Record<string, ReturnType<typeof glucoseStats>>; morning: (number | null)[]; afternoon: (number | null)[] } = {
    minutes: Array.from({ length: profileBins }, (_, i) => i * PROFILE_BIN + PROFILE_BIN / 2),
    days: { morning: 0, afternoon: 0 }, stats: {}, morning: [], afternoon: [],
  }
  for (const key of ['morning', 'afternoon'] as const) {
    const ds = out.filter((d) => d.shift === key && d.glucose.length >= 144)
    const sums = new Array(profileBins).fill(0)
    const counts = new Array(profileBins).fill(0)
    for (const d of ds) for (const [minute, v] of d.glucose) { const b = Math.min(profileBins - 1, Math.floor(minute / PROFILE_BIN)); sums[b] += v; counts[b]++ }
    shiftProfile.days[key] = ds.length
    // A műszak összes napjának glükóz-statisztikája (a sávokhoz).
    shiftProfile.stats[key] = glucoseStats(ds.flatMap((d) => [...d.glucose, ...d.manual].map((g) => g[1])), low, high)
    shiftProfile[key] = sums.map((s, i) => (counts[i] >= 3 ? Math.round((s / counts[i]) * 10) / 10 : null))
  }

  return {
    days, start, end, today,
    shiftProfile,
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
