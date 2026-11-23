// Autopilot: "mintha lenne pumpa" adagjavaslat. Percenként újraértékel (server/plugins/notifier.ts), de a pumpa
// dózisa itt egy push-értesítés, amit kötelező nyugtázni ("Beadtam"/"Kihagyom") az Autopilot oldalon — a háttérciklus
// soha nem ír be adagot magától, csak a nyugtázás (acceptSuggestion). Az elfogadott adag egy normál `entries` sor
// (source='autopilot'), a meglévő elemzés/IOB-számítás ettől függetlenül, változatlanul kezeli.
// A döntés tiszta magja (decideAutopilot) az autopilotCore.ts-ben van, DB/óra-függés nélkül — ezt teszteli a
// tests/autopilot.test.ts; ez a fájl csak az I/O-s réteg (DB, push, percenkénti ciklus).
import { db } from './db'
import { therapy, segmentAt } from './therapy'
import { predictGlucose, predictSeries, type Prediction } from './predict'
import { targetRange } from './range'
import { sendPush, listSubscriptions, type PushPayload } from './push'
import { markDirty } from './computed'
import { ymdInTz, startOfDayTs, addDaysYmd } from './time'
import { sgText } from '#shared/utils/glucose'
import { decideAutopilot, DEFAULTS, HARD, validateAutopilot, type AutopilotSettings, type Decision, type SuggestionKind, type SuggestionStatus } from './autopilotCore'

export { decideAutopilot, validateAutopilot, HARD, type AutopilotSettings, type Decision, type SuggestionKind, type SuggestionStatus, type DecideInput } from './autopilotCore'

export const AUTOPILOT_SOURCE = 'autopilot'

export function autopilotSettings(): AutopilotSettings {
  return { ...DEFAULTS, ...(setting<Partial<AutopilotSettings>>('autopilot', null) ?? {}) }
}

export interface Suggestion {
  id: number
  ts: number
  kind: SuggestionKind
  amount: number
  snapshot: Record<string, unknown>
  status: SuggestionStatus
  expiresAt: number
  decidedAt: number | null
  decidedAmount: number | null
  actedEntryId: number | null
}

function rowToSuggestion(r: any): Suggestion {
  let snapshot: Record<string, unknown> = {}
  try { snapshot = JSON.parse(r.snapshot) } catch { /* régi/sérült sor: üres */ }
  return {
    id: Number(r.id), ts: Number(r.ts), kind: r.kind, amount: Number(r.amount), snapshot,
    status: r.status, expiresAt: Number(r.expires_at),
    decidedAt: r.decided_at == null ? null : Number(r.decided_at),
    decidedAmount: r.decided_amount == null ? null : Number(r.decided_amount),
    actedEntryId: r.acted_entry_id == null ? null : Number(r.acted_entry_id),
  }
}

export function pendingSuggestion(): Suggestion | null {
  const r = db().prepare("SELECT * FROM autopilot_suggestions WHERE status = 'pending' ORDER BY ts DESC LIMIT 1").get()
  return r ? rowToSuggestion(r) : null
}

export function suggestionHistory(days = 7): Suggestion[] {
  const since = Math.floor(Date.now() / 1000) - days * 86400
  return (db().prepare('SELECT * FROM autopilot_suggestions WHERE ts >= ? ORDER BY ts DESC, id DESC').all(since) as any[]).map(rowToSuggestion)
}

function lastDecidedAt(status: 'accepted' | 'declined'): number | null {
  const r = db().prepare('SELECT decided_at FROM autopilot_suggestions WHERE status = ? ORDER BY decided_at DESC LIMIT 1').get(status) as { decided_at: number } | undefined
  return r ? Number(r.decided_at) : null
}

/** Az aznap (helyi nap) `entries`-be elfogadott Autopilot-mennyiség, fajtánként (subtype különbözteti meg). */
function todayGivenUnits(kind: SuggestionKind, nowTs: number): number {
  const ymd = ymdInTz(nowTs)
  const start = startOfDayTs(ymd)
  const end = startOfDayTs(addDaysYmd(ymd, 1))
  const subCond = kind === 'correction' ? "subtype = 'correction'" : 'subtype IS NULL'
  const r = db()
    .prepare(`SELECT COALESCE(SUM(value), 0) v FROM entries WHERE type = 'insulin' AND source = ? AND ${subCond} AND ts >= ? AND ts < ?`)
    .get(AUTOPILOT_SOURCE, start, end) as { v: number }
  return Number(r.v)
}

function autopilotPayload(decision: Decision, p: Prediction, expireMin: number): PushPayload {
  const amt = decision.amount.toLocaleString('hu-HU', { maximumFractionDigits: 1 })
  const label = decision.kind === 'correction' ? 'korrekció' : 'mikro-kiegészítés'
  const note = decision.kind === 'basal_micro' ? ' Ez egy kiegészítő, nem visszavonható adag a tartósan magas trend miatt, nem korrekció.' : ''
  return {
    title: `🛩️ Autopilot: ${amt} E ${label} javasolt`,
    body: `Most ${sgText(p.now.v)} ${p.now.arrow}. Az aktív inzulin (${p.iob.toFixed(1)} E) után is kb. ${p.eventual.toFixed(1)} mmol/L várható.${note} Nyisd meg az Autopilot oldalt és nyugtázd (lejár ${expireMin} perc múlva).`,
    url: '/autopilot',
    tag: 'autopilot',
  }
}

/** A `predictSeries()` +60..+180 perces szakasza tartósan cél fölött van-e, és a hosszú távú érték is (lásd DecideInput.sustainedHigh). */
function computeSustainedHigh(p: Prediction, nowTs: number): boolean {
  const range = targetRange()
  if (!(p.eventual > range.high)) return false
  const series = predictSeries(3, nowTs)
  const win = series.filter(([ms]) => {
    const min = (ms / 1000 - nowTs) / 60
    return min >= 60 && min <= 180
  })
  if (!win.length) return false
  return win.filter(([, v]) => v > range.high).length / win.length >= 0.8
}

/** Egymást követő, nyugtázatlanul lejárt javaslatok sorozata → a motor magát kikapcsolja (nem kapcsol vissza magától). */
async function maybeAutoDisable(cfg: AutopilotSettings): Promise<boolean> {
  const recent = db().prepare('SELECT status FROM autopilot_suggestions ORDER BY ts DESC LIMIT ?').all(HARD.autoDisableAfterExpired) as { status: string }[]
  if (recent.length < HARD.autoDisableAfterExpired || !recent.every((r) => r.status === 'expired')) return false
  saveSettings({ autopilot: { ...cfg, enabled: false } })
  if (listSubscriptions().length) {
    await sendPush({
      title: '🛩️ Az Autopilot leállt',
      body: `${HARD.autoDisableAfterExpired} egymást követő javaslatra nem érkezett válasz, ezért kikapcsolt. Ha szeretnéd, kapcsold vissza az Autopilot oldalon.`,
      url: '/autopilot',
      tag: 'autopilot',
    }, { urgency: 'normal', ttl: 3600 }).catch(() => null)
  }
  return true
}

export async function checkAutopilot(nowTs = Math.floor(Date.now() / 1000)): Promise<void> {
  const d = db()
  // Lejárat-kezelés mindig fut, engedélyezéstől függetlenül (a sor megmarad, csak a státusza vált — ez maga a napló).
  d.prepare("UPDATE autopilot_suggestions SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").run(nowTs)

  const cfg = autopilotSettings()
  if (cfg.enabled && (await maybeAutoDisable(cfg))) return
  if (!cfg.enabled) return
  if (d.prepare("SELECT 1 FROM autopilot_suggestions WHERE status = 'pending' LIMIT 1").get()) return

  const p = predictGlucose(30, nowTs)
  if (!p) return

  const t = therapy()
  const decision = decideAutopilot({
    settings: cfg,
    hasPending: false,
    secSinceAccepted: (() => { const x = lastDecidedAt('accepted'); return x == null ? null : nowTs - x })(),
    secSinceDeclined: (() => { const x = lastDecidedAt('declined'); return x == null ? null : nowTs - x })(),
    todayCorrectionUnits: todayGivenUnits('correction', nowTs),
    todayBasalMicroUnits: todayGivenUnits('basal_micro', nowTs),
    maxBolus: t?.maxBolus ?? null,
    prediction: { risk: p.risk, iob: p.iob, insulinNeeded: p.insulinNeeded, insulinFull: p.insulinFull },
    sustainedHigh: cfg.basalMicroEnabled ? computeSustainedHigh(p, nowTs) : false,
    doseStep: setting<{ doseStep?: number }>('notify', null)?.doseStep === 0.5 ? 0.5 : 1,
  })
  if (!decision) return

  d.exec('BEGIN')
  try {
    // Még egyszer, a tranzakción belül: szerver-újraindítás/párhuzamos hívás ellen.
    if (d.prepare("SELECT 1 FROM autopilot_suggestions WHERE status = 'pending' LIMIT 1").get()) { d.exec('ROLLBACK'); return }
    const expiresAt = nowTs + cfg.expireMin * 60
    const seg = t ? segmentAt(t, nowTs) : null
    const snapshot = JSON.stringify({ now: p.now, iob: p.iob, cob: p.cob, eventual: p.eventual, target: seg?.target ?? null, isf: seg?.isf ?? null })
    d.prepare("INSERT INTO autopilot_suggestions (ts, kind, amount, snapshot, status, expires_at) VALUES (?, ?, ?, ?, 'pending', ?)")
      .run(nowTs, decision.kind, decision.amount, snapshot, expiresAt)
    d.exec('COMMIT')
    if (listSubscriptions().length) {
      await sendPush(autopilotPayload(decision, p, cfg.expireMin), { urgency: 'normal', ttl: cfg.expireMin * 60 }).catch(() => null)
    }
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

export function acceptSuggestion(id: number, amount?: number): { ok: true; entryId: number } | { ok: false; error: string } {
  const d = db()
  const row = d.prepare("SELECT * FROM autopilot_suggestions WHERE id = ? AND status = 'pending'").get(id) as any
  if (!row) return { ok: false, error: 'A javaslat már nem aktuális.' }
  const amt = amount != null && Number.isFinite(amount) && amount > 0 ? Math.round(amount * 10) / 10 : Number(row.amount)
  const now = Math.floor(Date.now() / 1000)
  const subtype = row.kind === 'correction' ? 'correction' : null
  d.exec('BEGIN')
  try {
    const info = d
      .prepare("INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at) VALUES ('insulin', ?, ?, ?, ?, ?)")
      .run(now, amt, subtype, AUTOPILOT_SOURCE, now)
    if (Number(info.changes) === 0) {
      d.exec('ROLLBACK')
      return { ok: false, error: 'Pontosan ilyen bejegyzés (időpont és mennyiség) már van a naplóban.' }
    }
    const entryId = Number(info.lastInsertRowid)
    d.prepare("UPDATE autopilot_suggestions SET status = 'accepted', decided_at = ?, decided_amount = ?, acted_entry_id = ? WHERE id = ?")
      .run(now, amt, entryId, id)
    d.exec('COMMIT')
    markDirty()
    return { ok: true, entryId }
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

export function declineSuggestion(id: number): { ok: true } | { ok: false; error: string } {
  const now = Math.floor(Date.now() / 1000)
  const info = db().prepare("UPDATE autopilot_suggestions SET status = 'declined', decided_at = ? WHERE id = ? AND status = 'pending'").run(now, id)
  if (Number(info.changes) === 0) return { ok: false, error: 'A javaslat már nem aktuális.' }
  return { ok: true }
}
