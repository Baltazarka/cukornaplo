// Időszakos nézet (7 / 14 / 30 nap): ambuláns glükózprofil (AGP) – a nap időpontja szerint
// medián, 25–75% és 5–95% sáv –, óránkénti átlagos inzulin és CH, statisztika, napi összesítő.
import { db } from '../utils/db'
import { glucoseStats, RANGE_VERY_LOW, RANGE_VERY_HIGH } from '../utils/stats'
import { targetRange } from '../utils/range'
import { startOfDayTs, todayYmd, addDaysYmd, minuteOfDayInTz } from '../utils/time'
import { groupByDay, summaryRows } from '../utils/summary'

const PERIODS = [7, 14, 30]
const BIN_MIN = 15 // 96 sáv naponta
const BINS = 1440 / BIN_MIN

/** Percentilis lineáris interpolációval (rendezett tömbön). */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

const r1 = (v: number) => Math.round(v * 10) / 10
const fmtYmd = (ymd: string) => ymd.replaceAll('-', '. ') + '.'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const days = PERIODS.includes(Number(q.days)) ? Number(q.days) : 14
  const { low, high } = targetRange()
  const today = todayYmd()
  let end = typeof q.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.end) ? q.end : today
  if (end > today) end = today
  const start = addDaysYmd(end, -(days - 1))
  const startTs = startOfDayTs(start)
  const endTs = startOfDayTs(addDaysYmd(end, 1))

  const rows = db()
    .prepare('SELECT type, ts, value, subtype FROM entries WHERE ts >= ? AND ts < ? ORDER BY ts')
    .all(startTs, endTs) as { type: string; ts: number; value: number; subtype: string | null }[]

  const bins: number[][] = Array.from({ length: BINS }, () => [])
  const bolus = new Array(24).fill(0)
  const basal = new Array(24).fill(0)
  const carbs = new Array(24).fill(0)
  const glucose: number[] = []
  for (const r of rows) {
    const m = minuteOfDayInTz(Number(r.ts))
    const v = Number(r.value)
    if (r.type === 'glucose') {
      bins[Math.floor(m / BIN_MIN)].push(v)
      glucose.push(v)
    } else if (r.type === 'insulin') {
      ;(r.subtype === 'basal' ? basal : bolus)[Math.floor(m / 60)] += v
    } else {
      carbs[Math.floor(m / 60)] += v
    }
  }

  // Percentilisek sávonként; simításként a szomszédos sávok (±15 perc) értékeit is beszámítjuk.
  const agp = { minutes: [] as number[], p5: [] as (number | null)[], p25: [] as (number | null)[], p50: [] as (number | null)[], p75: [] as (number | null)[], p95: [] as (number | null)[] }
  for (let i = 0; i < BINS; i++) {
    const pool = [...bins[(i - 1 + BINS) % BINS], ...bins[i], ...bins[(i + 1) % BINS]].sort((a, b) => a - b)
    agp.minutes.push(i * BIN_MIN + BIN_MIN / 2)
    const ok = pool.length >= 5
    agp.p5.push(ok ? r1(quantile(pool, 0.05)) : null)
    agp.p25.push(ok ? r1(quantile(pool, 0.25)) : null)
    agp.p50.push(ok ? r1(quantile(pool, 0.5)) : null)
    agp.p75.push(ok ? r1(quantile(pool, 0.75)) : null)
    agp.p95.push(ok ? r1(quantile(pool, 0.95)) : null)
  }

  // Napi átlagok: csak azokra a napokra osztunk, amelyeken volt InPen-bejegyzés (különben a kimaradt napok lehúznák).
  const daily = groupByDay(rows)
  const penDays = Object.values(daily).filter((d) => d.insulin > 0 || d.carbs > 0).length || 1
  const perDay = (arr: number[]) => arr.map((v) => Math.round((v / penDays) * 100) / 100)

  // Lefedettség: a mérések száma az időszak eltelt részéhez képest (ma csak a mostanáig eltelt idő számít).
  const elapsedSec = Math.min(endTs, Math.floor(Date.now() / 1000)) - startTs
  const coverage = elapsedSec > 0 ? Math.min(100, (100 * glucose.length) / (elapsedSec / 300)) : 0

  const totalInsulin = bolus.reduce((a, b) => a + b, 0) + basal.reduce((a, b) => a + b, 0)
  const totalCarbs = carbs.reduce((a, b) => a + b, 0)

  return {
    days,
    start,
    end,
    today,
    label: `${fmtYmd(start)} – ${fmtYmd(end)}`,
    prevEnd: addDaysYmd(end, -days),
    nextEnd: end >= today ? null : (addDaysYmd(end, days) > today ? today : addDaysYmd(end, days)),
    range: { veryLow: RANGE_VERY_LOW, low, high, veryHigh: RANGE_VERY_HIGH },
    agp,
    hourly: { bolus: perDay(bolus), basal: perDay(basal), carbs: perDay(carbs) },
    stats: glucoseStats(glucose, low, high),
    totals: { insulinPerDay: totalInsulin / penDays, carbsPerDay: totalCarbs / penDays, penDays },
    coverage,
    summary: summaryRows(daily, end, days, low, high),
  }
})
