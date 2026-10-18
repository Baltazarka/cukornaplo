// Kézi bejegyzés a naplóba: inzulin (E), szénhidrát (g) vagy vércukor (mmol/L, kézi mérés, nem szenzoradat),
// időponttal (az app időzónájában).
// { date: 'YYYY-MM-DD', time: 'HH:MM', type: 'insulin' | 'carbs' | 'glucose', value, sub?: meal | correction | basal
//   (inzulin) vagy fatty | fast (CH), fat?, protein? (g, CH-hoz), force?: true }
// Friss (30 percen belüli) zsíros étkezésnél zsír / fehérje megadásával a zsír-fehérje emlékeztető is beáll.
// Ha 30 percen belül már van ugyanilyen típusú bejegyzés, 409-cel visszaszól (force: true-val mégis
// felveszi). Ha a telefon (Apple Health) később ugyanezt az adagot küldi, a kézi sor beolvad (db.ts storeRows).
import { markDirty } from '../utils/computed'
import { isAssumedBasal } from '../utils/basal'
import { db, MANUAL_SOURCE, MANUAL_MATCH_SEC } from '../utils/db'
import { hmInTz, ymdInTz, wallToTs } from '../utils/time'
import { therapy, segmentAt, DEFAULT_FPU_PERCENT } from '../utils/therapy'
import { addFpuReminder } from '../utils/notify'
import { fpuSuggestion, MACRO_MAX_G } from '#shared/utils/fpu'

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
  let sub = (SUBS[type] as readonly string[]).includes(body.sub) ? String(body.sub) : null
  // Zsír / fehérje (g), csak CH-hoz; üresen nincs megadva.
  const macro = (v: unknown): number | null | 'bad' => {
    if (v == null || v === '') return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 && n <= MACRO_MAX_G ? Math.round(n * 10) / 10 : 'bad'
  }
  const fat = type === 'carbs' ? macro(body.fat) : null
  const protein = type === 'carbs' ? macro(body.protein) : null
  if (fat === 'bad' || protein === 'bad') {
    setResponseStatus(event, 400)
    return { ok: false, error: `A zsír és a fehérje 0–${MACRO_MAX_G} g lehet.` }
  }
  // Típus nélküli, a beállított bázisadaggal egyező inzulin bázis (mint az adatfogadásnál).
  if (type === 'insulin' && sub === null && isAssumedBasal(value, null)) sub = 'basal'

  // Időpont nélkül a pontos mostani pillanat (óraátállításkor sem kétértelmű); faliidőből a már elmúlt előfordulás.
  const ts = body.date || body.time ? wallToTs(date, time, nowSec) : nowSec
  if (ts > nowSec + 15 * 60) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'Az időpont nem lehet a jövőben.' }
  }

  // Hasonló bejegyzés a közelben (pl. véletlenül kétszer beírva, vagy a telefon már elküldte): csak rákérdezünk. (Vércukornál nincs ilyen: a szenzor
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
    .prepare('INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at, fat, protein) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(type, ts, value, sub, MANUAL_SOURCE, now, fat, protein)
  if (Number(info.changes) === 0) {
    setResponseStatus(event, 409)
    return { ok: false, error: 'Pontosan ilyen bejegyzés (időpont és mennyiség) már van.' }
  }
  markDirty()
  // Friss zsíros étkezés zsír / fehérje adattal: emlékeztető 1,5 óra múlva (a napszak CH-arányával és a beállított %-kal).
  let fpu = null
  const t = therapy()
  if (type === 'carbs' && sub === 'fatty' && t && now - ts <= 30 * 60) {
    fpu = fpuSuggestion(fat, protein, segmentAt(t, ts).icr, t.fpuPercent ?? DEFAULT_FPU_PERCENT)
    // Egyben adásnál (a plusz adag az étkezési bólussal együtt) ellenőrző emlékeztető jön, különben a plusz adagra.
    if (fpu && fpu.extra >= 0.5) {
      addFpuReminder({ mealTs: ts, extra: fpu.extra, units: fpu.units, hours: fpu.hours, pct: fpu.pct, mode: t.fpuTiming === 'together' ? 'check' : 'extra' })
    }
  }
  return { ok: true, id: Number(info.lastInsertRowid), fpu }
})
