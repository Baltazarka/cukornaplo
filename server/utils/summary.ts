// Napi összesítés (glükóz, inzulin, CH) – a napi és az időszakos nézet közös része.
import { glucoseStats } from './stats'
import { ymdInTz, addDaysYmd, huWeekday } from './time'

export interface DailyBucket {
  glucose: number[]
  insulin: number
  carbs: number
  doses: number
}

/** Bejegyzések napokra bontva (kulcs: 'YYYY-MM-DD' az app időzónájában). */
export function groupByDay(rows: { type: string; ts: number; value: number; source?: string | null }[]): Record<string, DailyBucket> {
  const daily: Record<string, DailyBucket> = {}
  for (const r of rows) {
    const key = ymdInTz(Number(r.ts))
    // A kézzel felvitt vércukor nem szenzoradat: a CGM-statisztikákból kimarad.
    if (r.type === 'glucose' && r.source === 'manual') continue
    const d = (daily[key] ??= { glucose: [], insulin: 0, carbs: 0, doses: 0 })
    const v = Number(r.value)
    if (r.type === 'glucose') d.glucose.push(v)
    else if (r.type === 'insulin') { d.insulin += v; d.doses++ }
    else d.carbs += v
  }
  return daily
}

/** Az utolsó `count` nap sorai `endDay`-től visszafelé (a táblázathoz). */
export function summaryRows(daily: Record<string, DailyBucket>, endDay: string, count: number, low: number, high: number) {
  const out = []
  for (let i = 0; i < count; i++) {
    const k = addDaysYmd(endDay, -i)
    const row = daily[k]
    const s = row ? glucoseStats(row.glucose, low, high) : { n: 0 }
    out.push({
      date: k,
      label: k.slice(5).replace('-', '. ') + '.',
      weekday: huWeekday(k).slice(0, 3),
      n: s.n,
      avg: s.n ? s.avg : null,
      inRange: s.n ? s.pct!.inRange : null,
      low: s.n ? s.pct!.low + s.pct!.veryLow : null,
      insulin: row?.insulin || null,
      doses: row?.doses || null,
      carbs: row?.carbs || null,
    })
  }
  return out
}
