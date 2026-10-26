// Összefoglalók az e-mailekhez (heti riport, megosztási levél): időszaki statisztika és az utolsó érték.
import { db } from './db'
import { glucoseStats } from './stats'
import { targetRange } from './range'
import { startOfDayTs, addDaysYmd, hmInTz, todayYmd } from './time'
import { detectHypos } from './hypo'
import { lastTrend, type GPoint } from './trend'
import { groupByDay, summaryRows } from './summary'

const READS_PER_DAY = 288 // 5 percenkénti CGM-mérés

/** mmol/L egy tizedessel, magyar tizedesvesszővel. */
export const fmt1 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const fmtPct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : `${Math.round(v)}%`)

/** Trendnyíl szövegként (a levelezőben nincs ikonfont). */
export function trendArrow(t: { dir: -1 | 0 | 1; level: 0 | 1 | 2 | 3 } | null): string {
  if (!t || t.dir === 0) return '→'
  const up = t.dir === 1
  return t.level === 1 ? (up ? '↗' : '↘') : t.level === 2 ? (up ? '↑' : '↓') : up ? '⇈' : '⇊'
}

/** Vércukor-mérések; a `manual` jelzi a kézzel felvitt (nem szenzor) értéket. A trendhez csak a szenzoradat használható. */
export function glucosePoints(from: number, to: number): (GPoint & { manual: boolean })[] {
  const rows = db()
    .prepare("SELECT ts, value, source FROM entries WHERE type = 'glucose' AND ts >= ? AND ts < ? AND excluded = 0 ORDER BY ts")
    .all(from, to) as { ts: number; value: number; source: string | null }[]
  return rows.map((r) => ({ ts: Number(r.ts), v: Number(r.value), manual: r.source === 'manual' }))
}

export interface Latest { ts: number; v: number; time: string; ageMin: number; arrow: string; rate: number | null }

/** Az utolsó mérés (legfeljebb 3 órás), trenddel. */
export function latestGlucose(nowTs = Math.floor(Date.now() / 1000)): Latest | null {
  const pts = glucosePoints(nowTs - 3 * 3600, nowTs + 60)
  if (!pts.length) return null
  const last = pts[pts.length - 1]
  // A trend csak a szenzoradatból számolódik (a kézi mérés nem egyenletes mintavétel); ha a legutóbbi érték kézi, nincs nyíl.
  const trend = last.manual ? null : lastTrend(pts.filter((p) => !p.manual))
  return { ts: last.ts, v: last.v, time: hmInTz(last.ts), ageMin: Math.round((nowTs - last.ts) / 60), arrow: trendArrow(trend), rate: trend?.rate ?? null }
}

export interface Digest {
  start: string
  end: string
  days: number
  stats: ReturnType<typeof glucoseStats>
  hypos: number
  coverage: number
  avgInsulin: number | null
  avgCarbs: number | null
  rows: ReturnType<typeof summaryRows>
  low: number
  high: number
}

/** Egy `days` napos időszak (az `end` napig, azt is beleértve) összefoglalója. */
export function periodDigest(end: string, days: number): Digest {
  const start = addDaysYmd(end, -(days - 1))
  const from = startOfDayTs(start)
  const to = startOfDayTs(addDaysYmd(end, 1))
  const { low, high } = targetRange()
  const entries = db()
    .prepare('SELECT type, ts, value, source FROM entries WHERE ts >= ? AND ts < ? AND excluded = 0 ORDER BY ts')
    .all(from, to) as { type: string; ts: number; value: number; source: string | null }[]
  const glucose = entries.filter((e) => e.type === 'glucose').map((e) => ({ ts: Number(e.ts), v: Number(e.value) }))
  const stats = glucoseStats(glucose.map((p) => p.v), low, high)
  const daily = groupByDay(entries)
  const rows = summaryRows(daily, end, days, low, high).reverse()
  // A mai (még le nem zárt) napot a napi átlagokból kihagyjuk, ha van lezárt nap adattal (mint az időszakos nézetben).
  const today = todayYmd()
  const closed = rows.filter((r) => r.date !== today)
  const avgRows = closed.some((r) => r.insulin || r.carbs) ? closed : rows
  const withInsulin = avgRows.filter((r) => r.insulin)
  const withCarbs = avgRows.filter((r) => r.carbs)
  const elapsedDays = Math.min(days, Math.max(1, (Math.min(to, Math.floor(Date.now() / 1000)) - from) / 86400))
  return {
    start, end, days, stats, low, high,
    hypos: detectHypos(glucose, low).length,
    // A lefedettség csak a szenzor méréseit számolja (a kézi mérés nem pótolja a szenzoradatot).
    coverage: Math.min(100, (100 * entries.filter((e) => e.type === 'glucose' && e.source !== 'manual').length) / (elapsedDays * READS_PER_DAY)),
    avgInsulin: withInsulin.length ? withInsulin.reduce((a, r) => a + (r.insulin ?? 0), 0) / withInsulin.length : null,
    avgCarbs: withCarbs.length ? withCarbs.reduce((a, r) => a + (r.carbs ?? 0), 0) / withCarbs.length : null,
    rows,
  }
}
