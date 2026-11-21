// Autopilot (külön modul): a naplóból (szenzor, inzulin, CH, terápiás beállítás) olvas, a saját beállításai és naplója
// az `autopilot_log` táblában / a settings.json `autopilot` kulcsán vannak. Csak javaslatot ad (push + oldal), nem ír
// a naplóba, és nem módosítja a többi rész működését. A döntés maga a `autopilotEngine.ts`.
import { insulinModel } from '#shared/utils/insulins'
import { db } from './db'
import { therapy, segmentAt, blendAt, actionMinutesAt } from './therapy'
import { rapidDoses, iobAt, bolusPeak } from './iob'
import { cobAt } from './absorption'
import { targetRange } from './range'
import { listSubscriptions, sendPush } from './push'
import { apDecide, type ApDecision, type ApParams } from './autopilotEngine'

export interface ApSettings {
  enabled: boolean
  push: boolean
  fraction: number
  maxIob: number
  maxStep: number
  spacingMin: number
  /** Ennyi E-nél pontosabban nem tudsz adagolni (a toll lépésköze): a javaslat erre kerekítve, lefelé. */
  doseStep: number
}

const DEFAULTS: ApSettings = { enabled: false, push: true, fraction: 0.5, maxIob: 3, maxStep: 5, spacingMin: 60, doseStep: 1 }
const LOG_DAYS = 120

export function apSettings(): ApSettings {
  // Amíg nincs elmentve, az aktív inzulin határa a terápiában beállított legnagyobb egyszeri adag fele (nem fix 3 E:
  // étkezési bólus után órákig ennél több az aktív inzulin, és akkor soha nem javasolna). A határot a diabetológussal
  // egyeztetve érdemes megadni.
  const maxBolus = therapy()?.maxBolus
  const maxIob = maxBolus ? Math.min(30, Math.max(0.5, Math.floor(maxBolus) / 2)) : DEFAULTS.maxIob
  return { ...DEFAULTS, maxIob, ...(setting<Partial<ApSettings>>('autopilot', null) ?? {}) }
}

const clampTo = (v: unknown, min: number, max: number, step: number, def: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n / step) * step)) : def
}

export function validateApSettings(b: any): ApSettings {
  const doseStep = b?.doseStep === 0.5 ? 0.5 : 1
  return {
    enabled: b?.enabled === true,
    push: b?.push !== false,
    fraction: clampTo(b?.fraction, 0.25, 1, 0.25, DEFAULTS.fraction),
    maxIob: clampTo(b?.maxIob, 0.5, 30, 0.5, DEFAULTS.maxIob),
    // Legalább egy adagolási lépés: különben lefelé kerekítve soha nem javasolna.
    maxStep: Math.max(doseStep, clampTo(b?.maxStep, 0.5, 30, 0.5, DEFAULTS.maxStep)),
    spacingMin: clampTo(b?.spacingMin, 30, 240, 15, DEFAULTS.spacingMin),
    doseStep,
  }
}

let tableReady = false
function apDb() {
  const d = db()
  if (!tableReady) {
    d.exec(`CREATE TABLE IF NOT EXISTS autopilot_log (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      bg_ts INTEGER NOT NULL,
      state TEXT NOT NULL,
      units REAL,
      full REAL,
      bg REAL,
      iob REAL,
      cob REAL,
      eventual REAL,
      min_pred REAL,
      pushed INTEGER NOT NULL DEFAULT 0,
      reasons TEXT NOT NULL DEFAULT '[]'
    )`)
    d.exec('CREATE INDEX IF NOT EXISTS autopilot_log_ts ON autopilot_log (ts)')
    tableReady = true
  }
  return d
}

/** Az Autopilot-napló törlése („Minden elölről”). */
export function apReset(): void {
  apDb().exec('DELETE FROM autopilot_log')
}

/** A mostani döntés a naplóból és a beállításokból; null, ha nincs terápiás beállítás. */
export function apCompute(nowTs = Math.floor(Date.now() / 1000)): ApDecision | null {
  const t = therapy()
  if (!t) return null
  const s = apSettings()
  const d = db()
  const carbRows = d
    .prepare("SELECT ts, value, subtype FROM entries WHERE type = 'carbs' AND ts >= ? AND ts <= ? ORDER BY ts")
    .all(nowTs - 12 * 3600, nowTs) as { ts: number; value: number; subtype: string | null }[]
  const carbs = carbRows.map((r) => ({ ts: Number(r.ts), v: Number(r.value), sub: r.subtype ?? null }))
  const doses = rapidDoses(t, nowTs - 60, nowTs + 1, carbs.map((c) => c.ts)).filter((x) => x.ts <= nowTs)
  const glucose = (d
    .prepare("SELECT ts, value FROM entries WHERE type = 'glucose' AND excluded = 0 AND IFNULL(source, '') != 'manual' AND ts BETWEEN ? AND ? ORDER BY ts")
    .all(nowTs - 3600, nowTs) as { ts: number; value: number }[]).map((r) => ({ ts: Number(r.ts), v: Number(r.value) }))
  const seg = segmentAt(t, nowTs)
  const b = blendAt(t, nowTs)
  const { low, high } = targetRange()
  const params: ApParams = {
    target: seg.target, isf: b?.isf ?? seg.isf, icr: b?.icr ?? seg.icr, low, high,
    fraction: s.fraction, maxIob: s.maxIob, maxStep: Math.min(s.maxStep, Math.floor(t.maxBolus / s.doseStep) * s.doseStep), minStep: s.doseStep, spacingMin: s.spacingMin,
  }
  const model = insulinModel(bolusPeak(t), actionMinutesAt(t, nowTs))
  return apDecide({
    nowTs, glucose, params,
    iobAt: (ts) => iobAt(doses, ts),
    cobAt: (ts) => cobAt(carbs, ts),
    lastBolusTs: doses.length ? Math.max(...doses.map((x) => x.ts)) : null,
    remaining: (m) => model.iob(m),
  })
}

/** Percenkénti ciklus: új szenzormérésenként egy naplósor, javaslatnál (ha be van kapcsolva) push. */
export async function apTick(nowTs = Math.floor(Date.now() / 1000)): Promise<void> {
  const s = apSettings()
  if (!s.enabled) return
  const dec = apCompute(nowTs)
  if (!dec || dec.bgTs == null) return
  const d = apDb()
  const lastLog = d.prepare('SELECT bg_ts FROM autopilot_log ORDER BY id DESC LIMIT 1').get() as { bg_ts: number } | undefined
  let logId: number | null = null
  if (!lastLog || Number(lastLog.bg_ts) !== dec.bgTs) {
    const info = d
      .prepare('INSERT INTO autopilot_log (ts, bg_ts, state, units, full, bg, iob, cob, eventual, min_pred, reasons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(nowTs, dec.bgTs, dec.state, dec.units, dec.full, dec.bg, dec.iob, dec.cob, dec.eventual, dec.minPred, JSON.stringify(dec.reasons))
    logId = Number(info.lastInsertRowid)
    d.prepare('DELETE FROM autopilot_log WHERE ts < ?').run(nowTs - LOG_DAYS * 86400)
  }
  if (dec.state !== 'suggest' || !dec.units || !s.push || !listSubscriptions().length) return
  const st = setting<{ lastPush?: number }>('autopilot_state', null) ?? {}
  if (nowTs - (st.lastPush ?? 0) < s.spacingMin * 60 - 30) return
  saveSettings({ autopilot_state: { lastPush: nowTs } })
  if (logId != null) d.prepare('UPDATE autopilot_log SET pushed = 1 WHERE id = ?').run(logId)
  const u = dec.units.toLocaleString('hu-HU', { maximumFractionDigits: 1 })
  await sendPush({
    title: `🤖 Autopilot: kb. ${u} E javasolt`,
    body: `${dec.reasons.join(' ')} Tájékoztató javaslat, a beadásról te döntesz.`,
    url: '/autopilot', tag: 'autopilot',
  }, { urgency: 'normal', ttl: 15 * 60 }).catch((e) => console.error('[autopilot push]', e))
}

export interface ApOutcome {
  ts: number
  units: number
  full: number | null
  bg: number
  eventual: number | null
  pushed: boolean
  /** A következő 30 percben beadott gyors hatású inzulin, E. */
  given: number
  at2h: number | null
  at4h: number | null
  min4h: number | null
}

/** A korábbi javaslatok visszamérése: mi lett a vércukor 2 és 4 óra múlva, és mit adtál be utána. */
export function apOutcomes(limit = 15): { rows: ApOutcome[]; summary: { n: number; followed: number; lowAfterFollowed: number } } {
  const s = apSettings()
  const { low } = targetRange()
  const d = apDb()
  const sug = d.prepare("SELECT ts, units, full, bg, eventual, pushed FROM autopilot_log WHERE state = 'suggest' ORDER BY ts").all() as any[]
  // Egy javaslat-epizódból egy sor: a következő csak a javaslati időköz után számít újnak.
  const kept: any[] = []
  for (const r of sug) if (!kept.length || Number(r.ts) - Number(kept[kept.length - 1].ts) >= s.spacingMin * 60) kept.push(r)
  const glucose = d.prepare("SELECT value FROM entries WHERE type = 'glucose' AND excluded = 0 AND IFNULL(source, '') != 'manual' AND ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) LIMIT 1")
  const range = d.prepare("SELECT MIN(value) m FROM entries WHERE type = 'glucose' AND excluded = 0 AND IFNULL(source, '') != 'manual' AND ts BETWEEN ? AND ?")
  const dose = d.prepare("SELECT COALESCE(SUM(value), 0) s FROM entries WHERE type = 'insulin' AND (subtype IS NULL OR subtype != 'basal') AND ts BETWEEN ? AND ?")
  const now = Math.floor(Date.now() / 1000)
  const rows: ApOutcome[] = kept.map((r) => {
    const ts = Number(r.ts)
    const at = (h: number) => (ts + h * 3600 <= now ? ((glucose.get(ts + h * 3600 - 300, ts + h * 3600 + 300, ts + h * 3600) as any)?.value ?? null) : null)
    const min4 = ts + 4 * 3600 <= now ? ((range.get(ts, ts + 4 * 3600) as any)?.m ?? null) : null
    return {
      ts, units: Number(r.units), full: r.full == null ? null : Number(r.full), bg: Number(r.bg),
      eventual: r.eventual == null ? null : Number(r.eventual), pushed: !!r.pushed,
      given: Number((dose.get(ts, ts + 1800) as any).s), at2h: at(2) == null ? null : Number(at(2)), at4h: at(4) == null ? null : Number(at(4)),
      min4h: min4 == null ? null : Number(min4),
    }
  })
  const followed = rows.filter((x) => x.given >= x.units * 0.5)
  return {
    rows: rows.slice(-limit).reverse(),
    summary: { n: rows.length, followed: followed.length, lowAfterFollowed: followed.filter((x) => x.min4h != null && x.min4h < low).length },
  }
}
