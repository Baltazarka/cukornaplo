// Egy kis JSON a telefon widgetjének (Scriptable): legutóbbi vércukor és trend, aktív inzulin (IOB),
// aktív szénhidrát (COB) és a 3 órás görbe. Saját X-Token-nel védett (mint az adatfogadó), a munkamenet nem kell.
// POST, hogy a kulcs ne kerülhessen URL-be / naplóba.
import { timingSafeEqual } from 'node:crypto'
import { db } from '../utils/db'
import { therapy } from '../utils/therapy'
import { targetRange } from '../utils/range'
import { lastTrend } from '../utils/trend'
import { rapidDoses, iobAt } from '../utils/iob'
import { cobAt } from '../utils/absorption'

const HOURS = 3

export default defineEventHandler((event) => {
  const token = String(getHeader(event, 'x-token') ?? '').trim()
  const expected = String(setting('api_token', '') ?? '')
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (expected === '' || a.length !== b.length || !timingSafeEqual(a, b)) {
    setResponseStatus(event, 401)
    return { ok: false, error: 'Hibás vagy hiányzó kulcs (X-Token).' }
  }

  const now = Math.floor(Date.now() / 1000)
  const { low, high } = targetRange()
  const sensor = (db()
    .prepare("SELECT ts, value FROM entries WHERE type = 'glucose' AND (source IS NULL OR source != 'manual') AND ts >= ? ORDER BY ts")
    .all(now - HOURS * 3600) as any[]).map((r) => ({ ts: Number(r.ts), v: Number(r.value) }))
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
    ok: true,
    now,
    glucose: last ? { v: last.v, ageMin: Math.max(0, Math.round((now - last.ts) / 60)) } : null,
    trend: tr ? { dir: tr.dir, level: tr.level } : null,
    iob,
    cob,
    range: { low, high },
    // [perccel ezelőtt, mmol/L], 5 perces mintavétel elég a vonalhoz
    series: sensor.map((p) => [Math.round((now - p.ts) / 60), p.v]),
  }
})
