// Kézi bejegyzés a naplóba: inzulin (E), szénhidrát (g) vagy vércukor (mmol/L, kézi mérés, nem szenzoradat),
// időponttal (az app időzónájában).
// { date: 'YYYY-MM-DD', time: 'HH:MM', type: 'insulin' | 'carbs' | 'glucose', value, sub?: meal | correction | basal
//   (inzulin) vagy fatty | fast (CH), force?: true }
// Ha 30 percen belül már van ugyanilyen típusú bejegyzés, 409-cel visszaszól (force: true-val mégis
// felveszi). Ha az InPen / Health később ugyanezt az adagot küldi, a kézi sor beolvad (db.ts storeRows).
import { db, MANUAL_SOURCE, MANUAL_MATCH_SEC } from '../utils/db'
import { zonedToTs } from '../utils/normalize'
import { hmInTz, ymdInTz } from '../utils/time'

const LIMITS = {
  insulin: { min: 0.1, max: 100, unit: 'E' },
  carbs: { min: 1, max: 500, unit: 'g' },
  glucose: { min: 1.5, max: 35, unit: 'mmol/L' },
} as const
const SUBS = { insulin: ['meal', 'correction', 'basal'], carbs: ['fatty', 'fast'], glucose: [] } as const

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const type = body.type === 'insulin' || body.type === 'carbs' || body.type === 'glucose' ? (body.type as 'insulin' | 'carbs' | 'glucose') : null
  // Dátum és időpont nélkül (pl. a bóluskalkulátorból) a mostani időpont számít, az app időzónájában.
  const nowSec = Math.floor(Date.now() / 1000)
  const date = String(body.date || ymdInTz(nowSec))
  const time = String(body.time || hmInTz(nowSec))
  if (!type) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Ismeretlen bejegyzéstípus.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Érvénytelen dátum vagy időpont.' }
  }
  const lim = LIMITS[type]
  const raw = Number(String(body.value ?? '').replace(',', '.'))
  // Inzulin és vércukor 0,1-re, CH egész grammra kerekítve.
  const value = type === 'carbs' ? Math.round(raw) : Math.round(raw * 10) / 10
  if (!Number.isFinite(raw) || value < lim.min || value > lim.max) {
    setResponseStatus(event, 400)
    return { ok: false, error: `A mennyiség ${lim.min}–${lim.max} ${lim.unit} lehet.` }
  }
  const sub = (SUBS[type] as readonly string[]).includes(body.sub) ? String(body.sub) : null

  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const ts = zonedToTs(y, mo, d, h, mi, 0)
  if (ts > Math.floor(Date.now() / 1000) + 15 * 60) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Az időpont nem lehet a jövőben.' }
  }

  // Hasonló bejegyzés a közelben (pl. az InPen már elküldte): csak rákérdezünk. (Vércukornál nincs ilyen: a szenzor
  // ötpercenként mér, a kézi mérés külön pont.)
  if (body.force !== true && type !== 'glucose') {
    const near = db()
      .prepare('SELECT ts, value FROM entries WHERE type = ? AND ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) LIMIT 1')
      .get(type, ts - MANUAL_MATCH_SEC, ts + MANUAL_MATCH_SEC, ts) as { ts: number; value: number } | undefined
    if (near) {
      setResponseStatus(event, 409)
      const v = Number(near.value).toLocaleString('hu-HU', { maximumFractionDigits: 1 })
      return {
        ok: false,
        duplicate: true,
        error: `${hmInTz(Number(near.ts))}-kor már van ${v} ${lim.unit} ${type === 'insulin' ? 'inzulin' : 'szénhidrát'} a naplóban.`,
      }
    }
  }

  const now = Math.floor(Date.now() / 1000)
  // Ha korábban pont ezt töröltük, a kézi felvétel visszaállítja.
  db().prepare('DELETE FROM deleted_entries WHERE type = ? AND ts = ? AND value = ?').run(type, ts, value)
  const info = db()
    .prepare('INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(type, ts, value, sub, MANUAL_SOURCE, now)
  if (Number(info.changes) === 0) {
    setResponseStatus(event, 409)
    return { ok: false, error: 'Pontosan ilyen bejegyzés (időpont és mennyiség) már van.' }
  }
  return { ok: true, id: Number(info.lastInsertRowid) }
})
