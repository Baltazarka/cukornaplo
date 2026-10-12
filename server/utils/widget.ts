// A telefon widgetjének adatai és beállításai (a /api/widget és a szerkesztő előnézete is ezt használja).
import { db } from './db'
import { therapy } from './therapy'
import { targetRange } from './range'
import { lastTrend } from './trend'
import { rapidDoses, iobAt } from './iob'
import { cobAt } from './absorption'

export function widgetConfig(): WidgetConfig {
  return sanitizeWidgetConfig(setting('widget_config', null))
}

/** Legutóbbi vércukor és trend, aktív inzulin / szénhidrát és a vonalhoz a görbe (perccel ezelőtt, mmol/L). */
export function widgetData(hours: number) {
  const now = Math.floor(Date.now() / 1000)
  const { low, high } = targetRange()
  const sensor = (db()
    .prepare("SELECT ts, value FROM entries WHERE type = 'glucose' AND (source IS NULL OR source != 'manual') AND ts >= ? ORDER BY ts")
    .all(now - Math.max(hours, 1) * 3600) as any[]).map((r) => ({ ts: Number(r.ts), v: Number(r.value) }))
  const last = sensor.at(-1)
  const tr = last ? lastTrend(sensor) : null

  // Inzulin és CH: a bóluskalkulátorral és a napi nézettel azonos számítás.
  const t = therapy()
  const carbRows = (db()
    .prepare("SELECT ts, value, subtype FROM entries WHERE type = 'carbs' AND ts >= ? ORDER BY ts")
    .all(now - 12 * 3600) as any[]).map((r) => ({ ts: Number(r.ts), v: Number(r.value), sub: r.subtype ?? null }))
  const iob = t ? Math.round(iobAt(rapidDoses(t, now, now + 1, carbRows.map((c) => c.ts)), now) * 10) / 10 : null
  const cob = Math.round(cobAt(carbRows, now))

  return {
    now,
    glucose: last ? { v: last.v, ageMin: Math.max(0, Math.round((now - last.ts) / 60)) } : null,
    trend: tr ? { dir: tr.dir, level: tr.level } : null,
    iob,
    cob,
    range: { low, high },
    series: sensor.map((p) => [Math.round((now - p.ts) / 60), p.v] as [number, number]),
  }
}
