// A bázis (Toujeo) automatikus beírása a Terápia oldali beállításból (therapy.basalAuto): naponta a megadott időpontban
// a megadott adag bázisként a naplóba kerül, ha aznap még nincs bázis beírva, és push értesítés megy róla.
// Az automatikus sor forrása `AUTO_BASAL_SOURCE`: a naplóban „automatikus” jelöléssel látszik, szerkeszthető és
// törölhető; ha az adott napra kézzel is beírod a bázist (utólag is), az automatikus sor helyére lép (entry-add).
// Naponta legfeljebb egyszer próbál (a `basal_auto.date` szerint): a törölt automatikus sor nem jön vissza.
import { db } from './db'
import { therapy } from './therapy'
import { markDirty } from './computed'
import { addDaysYmd, startOfDayTs, wallToTs, ymdInTz } from './time'
import { sendPush, listSubscriptions } from './push'
import { insulinById } from '#shared/utils/insulins'

/** Az automatikusan beírt bázissor forrása (entries.source). */
export const AUTO_BASAL_SOURCE = 'auto-basal'

/** Az adott nap automatikus bázissorainak törlése (a kézzel beírt bázis a helyükre lép). */
export function removeAutoBasal(ymd: string): number {
  return Number(db()
    .prepare("DELETE FROM entries WHERE type = 'insulin' AND subtype = 'basal' AND source = ? AND ts >= ? AND ts < ?")
    .run(AUTO_BASAL_SOURCE, startOfDayTs(ymd), startOfDayTs(addDaysYmd(ymd, 1))).changes)
}

/** Ennyi napra vissza pótolható a hiányzó bázis. */
const BACKFILL_MAX_DAYS = 180

/**
 * A hiányzó bázisnapok: a legelső naplózott bázis napjától ma-ig (ma csak, ha a beírás ideje már elmúlt) azok a napok, ahol
 * nincs bázis a naplóban. A kézzel törölt bázis napját kihagyja (tudatos törlés). A mostani (mentett) beállítás időpontját és
 * adagját használja, akkor is, ha az automatikus beírás ki van kapcsolva. Null, ha nincs beállított időpont és adag.
 */
export function missingBasalDays(nowTs = Math.floor(Date.now() / 1000)): { time: string; units: number; days: string[] } | null {
  const cfg = therapy()?.basalAuto
  if (!cfg) return null
  const d = db()
  const have = new Set((d.prepare("SELECT ts FROM entries WHERE type = 'insulin' AND subtype = 'basal'").all() as { ts: number }[]).map((r) => ymdInTz(Number(r.ts))))
  const out = { time: cfg.time, units: cfg.units, days: [] as string[] }
  if (!have.size) return out
  const deleted = new Set((d.prepare("SELECT ts FROM deleted_entries WHERE type = 'insulin' AND value = ?").all(cfg.units) as { ts: number }[]).map((r) => ymdInTz(Number(r.ts))))
  const today = ymdInTz(nowTs)
  const first = [...have].sort()[0]
  const earliest = addDaysYmd(today, -BACKFILL_MAX_DAYS)
  for (let day = first > earliest ? first : earliest; day <= today; day = addDaysYmd(day, 1)) {
    if (have.has(day) || deleted.has(day)) continue
    if (day === today && wallToTs(day, cfg.time, nowTs) > nowTs) continue
    out.days.push(day)
  }
  return out
}

/** A hiányzó napokra beírja a bázist (automatikus jelöléssel, szerkeszthető / törölhető). Visszaadja a napok számát. */
export function backfillBasal(nowTs = Math.floor(Date.now() / 1000)): number {
  const m = missingBasalDays(nowTs)
  if (!m || !m.days.length) return 0
  const d = db()
  const ins = d.prepare("INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at) VALUES ('insulin', ?, ?, 'basal', ?, ?)")
  let added = 0
  d.exec('BEGIN')
  try {
    for (const day of m.days) added += Number(ins.run(wallToTs(day, m.time, nowTs), m.units, AUTO_BASAL_SOURCE, nowTs).changes)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  if (added) markDirty()
  return added
}

/** Push értesítés csak a beadás idején (pl. szerver-újraindítás utáni pótlásnál órákkal később már nem). */
const PUSH_MAX_LATE_SEC = 30 * 60

export async function checkBasalAuto(nowTs = Math.floor(Date.now() / 1000)): Promise<void> {
  const t = therapy()
  const cfg = t?.basalAuto
  if (!cfg || cfg.enabled === false) return
  const today = ymdInTz(nowTs)
  if (setting<{ date: string } | null>('basal_auto', null)?.date === today) return
  const ts = wallToTs(today, cfg.time, nowTs)
  if (ts > nowTs) return

  const d = db()
  const has = d
    .prepare("SELECT 1 FROM entries WHERE type = 'insulin' AND subtype = 'basal' AND ts >= ? AND ts < ? LIMIT 1")
    .get(startOfDayTs(today), startOfDayTs(addDaysYmd(today, 1)))
  // Előbb a sor, utána az állapot: ha közben leállna a szerver, a következő körben már látja a (forrásáról
  // felismerhető) automatikus sort, és nem ír be másodikat.
  const info = has ? null : d
    .prepare("INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at) VALUES ('insulin', ?, ?, 'basal', ?, ?)")
    .run(ts, cfg.units, AUTO_BASAL_SOURCE, nowTs)
  saveSettings({ basal_auto: { date: today } })
  if (!info || Number(info.changes) === 0) return
  markDirty()

  if (nowTs - ts > PUSH_MAX_LATE_SEC || !listSubscriptions().length) return
  const units = cfg.units.toLocaleString('hu-HU', { maximumFractionDigits: 1 })
  const name = t?.basalInsulin ? insulinById(t.basalInsulin)?.name : null
  await sendPush({
    title: `💉 Bázis ideje: ${units} E${name ? ` ${name}` : ''}`,
    body: `Beírtam a naplóba ${cfg.time}-kor. Ha más adagot adtál be, vagy kimaradt, javítsd vagy töröld a naplóban.`,
    url: '/',
    tag: 'basal',
  }, { urgency: 'high', ttl: 2 * 3600 }).catch(() => null)
}
