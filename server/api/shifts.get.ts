// Mutatók műszak szerint (délelőttös / délutános / szabadnap), `days` napra az `end` napig (alapból tegnapig):
// célban töltött idő a saját tartományban és 3,9–10 között, átlag, magas / alacsony idő, egész napra és
// napszakonként (00–06, 06–14, 14–22, 22–24), valamint a napi bólus, korrekció, CH és a beírt bázis.
import type { ShiftKind } from '#shared/types/therapy'
import { SHIFT_KINDS } from '#shared/utils/shift'
import { db } from '../utils/db'
import { targetRange } from '../utils/range'
import { addDaysYmd, startOfDayTs, todayYmd, ymdInTz, minuteOfDayInTz } from '../utils/time'
import { shiftOn, shiftSchedule } from '../utils/therapy'
import { insulinKind, MEAL_WINDOW_SEC, PREBOLUS_SEC } from '../utils/insulinKind'

const PERIODS = [7, 14, 30, 60, 90]
const BLOCKS = [['00–06', 0, 6], ['06–14', 6, 14], ['14–22', 14, 22], ['22–24', 22, 24]] as const

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const days = PERIODS.includes(Number(q.days)) ? Number(q.days) : 30
  if (!shiftSchedule()) return { enabled: false, days }
  const { low, high } = targetRange()
  const today = todayYmd()
  const yesterday = addDaysYmd(today, -1)
  const end = typeof q.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.end) && q.end <= today ? q.end : yesterday
  const start = addDaysYmd(end, -(days - 1))
  const from = startOfDayTs(start)
  const to = startOfDayTs(addDaysYmd(end, 1))
  const rows = db()
    .prepare("SELECT type, ts, value, subtype, source FROM entries WHERE ts >= ? AND ts < ? AND excluded = 0 ORDER BY ts")
    .all(from - MEAL_WINDOW_SEC, to + PREBOLUS_SEC) as { type: string; ts: number; value: number; subtype: string | null; source: string | null }[]
  const carbTs = rows.filter((r) => r.type === 'carbs').map((r) => Number(r.ts))

  type Acc = { days: Set<string>; g: number[]; blocks: number[][]; bolus: number; corr: number; carbs: number; basalDays: Set<string> }
  const acc = Object.fromEntries(SHIFT_KINDS.map((k) => [k, { days: new Set(), g: [], blocks: BLOCKS.map(() => []), bolus: 0, corr: 0, carbs: 0, basalDays: new Set() } as Acc])) as Record<ShiftKind, Acc>
  const sensorDays = new Map<string, number>()
  // Napi összegek (a napi átlaghoz csak a legalább félig szenzoradatos napok számítanak).
  const daily = new Map<string, { bolus: number; corr: number; carbs: number; basal: boolean }>()
  const dayOf = (ymd: string) => {
    let x = daily.get(ymd)
    if (!x) daily.set(ymd, (x = { bolus: 0, corr: 0, carbs: 0, basal: false }))
    return x
  }
  for (const r of rows) {
    const ts = Number(r.ts)
    if (ts < from || ts >= to) continue
    const ymd = ymdInTz(ts)
    const shift = shiftOn(ymd)
    if (!shift) continue
    const a = acc[shift]
    const v = Number(r.value)
    if (r.type === 'glucose') {
      if (r.source === 'manual') continue
      sensorDays.set(ymd, (sensorDays.get(ymd) ?? 0) + 1)
      a.g.push(v)
      const h = Math.floor(minuteOfDayInTz(ts) / 60)
      a.blocks[BLOCKS.findIndex(([, h0, h1]) => h >= h0 && h < h1)].push(v)
    } else if (r.type === 'carbs') {
      dayOf(ymd).carbs += v
    } else {
      const k = insulinKind(ts, r.subtype, carbTs, v).kind
      const x = dayOf(ymd)
      if (k === 'basal') x.basal = true
      else {
        x.bolus += v
        if (k === 'correction') x.corr += v
      }
    }
  }
  for (const [ymd, n] of sensorDays) {
    if (n < 144) continue
    const a = acc[shiftOn(ymd)!]
    const x = daily.get(ymd)
    a.days.add(ymd)
    a.bolus += x?.bolus ?? 0
    a.corr += x?.corr ?? 0
    a.carbs += x?.carbs ?? 0
    if (x?.basal) a.basalDays.add(ymd)
  }

  const stat = (vals: number[]) => {
    if (!vals.length) return null
    const n = vals.length
    const pct = (f: (v: number) => boolean) => Math.round((1000 * vals.filter(f).length) / n) / 10
    return {
      n,
      avg: Math.round((10 * vals.reduce((s, v) => s + v, 0)) / n) / 10,
      tir: pct((v) => v >= low && v <= high),
      tir10: pct((v) => v >= 3.9 && v <= 10),
      below: pct((v) => v < low),
      veryHigh: pct((v) => v > 13.9),
    }
  }
  const per = (a: Acc, x: number) => (a.days.size ? Math.round((10 * x) / a.days.size) / 10 : null)
  return {
    enabled: true, days, start, end, range: { low, high },
    blocks: BLOCKS.map(([label]) => label),
    shifts: SHIFT_KINDS.map((k) => {
      const a = acc[k]
      return {
        kind: k,
        days: a.days.size,
        all: stat(a.g),
        blocks: a.blocks.map(stat),
        perDay: { bolus: per(a, a.bolus), correction: per(a, a.corr), carbs: per(a, a.carbs) },
        basalLogged: a.basalDays.size,
      }
    }),
  }
})
