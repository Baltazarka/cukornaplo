// A telefon widgetjének adatai és beállításai (a /api/widget és a szerkesztő előnézete is ezt használja).
import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { db } from './db'
import { therapy } from './therapy'
import { targetRange } from './range'
import { lastTrend } from './trend'
import { rapidDoses, iobAt } from './iob'
import { cobAt } from './absorption'
import { predictGlucose } from './predict'
import { notifySettings } from './notify'

/** A javaslat csak friss szenzoradatból (ennél régebbi értéknél nincs). */
const SUGGEST_MAX_AGE_SEC = 20 * 60

export function widgetConfig(): WidgetConfig {
  return sanitizeWidgetConfig(setting('widget_config', null))
}

/**
 * Legutóbbi vércukor és trend, aktív inzulin / szénhidrát, a javaslatok (a push-értesítésekkel azonos számítás: inzulin
 * magas cukornál, szénhidrát hipó-veszélynél) és a vonalhoz a görbe (perccel ezelőtt, mmol/L).
 */
export function widgetData(hours: number) {
  const now = Math.floor(Date.now() / 1000)
  const { low, high } = targetRange()
  const sensor = (db()
    .prepare("SELECT ts, value FROM entries WHERE type = 'glucose' AND (source IS NULL OR source != 'manual') AND ts >= ? AND excluded = 0 ORDER BY ts")
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

  // Javaslat: a push-értesítések szabályai (előrejelzési táv, legkisebb inzulinadag) szerint.
  let suggest: { insulin: number | null; carbs: number | null } = { insulin: null, carbs: null }
  if (last && now - last.ts <= SUGGEST_MAX_AGE_SEC) {
    const ns = notifySettings()
    const p = predictGlucose(ns.hypoHorizon, now)
    if (p) {
      suggest = {
        insulin: p.insulinNeeded != null && p.insulinNeeded >= ns.insulinMin ? p.insulinNeeded : null,
        carbs: p.risk ? p.carbsNeeded : null,
      }
    }
  }

  return {
    now,
    glucose: last ? { v: last.v, ts: last.ts, ageMin: Math.max(0, Math.round((now - last.ts) / 60)) } : null,
    trend: tr ? { dir: tr.dir, level: tr.level } : null,
    iob,
    cob,
    suggest,
    range: { low, high },
    series: sensor.map((p) => [Math.round((now - p.ts) / 60), p.v] as [number, number]),
  }
}

/** A widget-végpontok saját kulcsa (X-Token, mint az adatfogadónál): hiba esetén 401 és a válasz, különben null. */
export function widgetAuthError(event: H3Event): { ok: false; error: string } | null {
  const token = String(getHeader(event, 'x-token') ?? '').trim()
  const expected = String(setting('api_token', '') ?? '')
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (expected === '' || a.length !== b.length || !timingSafeEqual(a, b)) {
    setResponseStatus(event, 401)
    return { ok: false, error: 'Hibás vagy hiányzó kulcs (X-Token).' }
  }
  return null
}
