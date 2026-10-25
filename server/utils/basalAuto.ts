// A bázis (Toujeo) automatikus beírása a Terápia oldali beállításból (therapy.basalAuto): naponta a megadott időpontban
// a megadott adag bázisként a naplóba kerül, ha aznap még nincs bázis beírva, és push értesítés megy róla.
// A sor kézi bejegyzésként szerkeszthető és törölhető; ha aznap kézzel is beírod a bázist, az automatikus sor helyére
// lép (entry-add). Naponta legfeljebb egyszer próbál: a törölt automatikus sor nem jön vissza.
import { db, MANUAL_SOURCE } from './db'
import { therapy } from './therapy'
import { markDirty } from './computed'
import { addDaysYmd, startOfDayTs, wallToTs, ymdInTz } from './time'
import { sendPush, listSubscriptions } from './push'
import { insulinById } from '#shared/utils/insulins'

interface BasalAutoState { date: string; id: number | null }

/** Az adott napon automatikusan beírt bázissor azonosítója, ha van. */
export function autoBasalId(ymd: string): number | null {
  const st = setting<BasalAutoState | null>('basal_auto', null)
  return st?.date === ymd && st.id != null ? st.id : null
}

/** Push értesítés csak a beadás idején (pl. szerver-újraindítás utáni pótlásnál órákkal később már nem). */
const PUSH_MAX_LATE_SEC = 30 * 60

export async function checkBasalAuto(nowTs = Math.floor(Date.now() / 1000)): Promise<void> {
  const t = therapy()
  const cfg = t?.basalAuto
  if (!cfg) return
  const today = ymdInTz(nowTs)
  if (setting<BasalAutoState | null>('basal_auto', null)?.date === today) return
  const ts = wallToTs(today, cfg.time, nowTs)
  if (ts > nowTs) return

  const d = db()
  const has = d
    .prepare("SELECT 1 FROM entries WHERE type = 'insulin' AND subtype = 'basal' AND ts >= ? AND ts < ? LIMIT 1")
    .get(startOfDayTs(today), startOfDayTs(addDaysYmd(today, 1)))
  if (has) {
    saveSettings({ basal_auto: { date: today, id: null } })
    return
  }
  const info = d
    .prepare("INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at) VALUES ('insulin', ?, ?, 'basal', ?, ?)")
    .run(ts, cfg.units, MANUAL_SOURCE, nowTs)
  const id = Number(info.changes) > 0 ? Number(info.lastInsertRowid) : null
  saveSettings({ basal_auto: { date: today, id } })
  if (id == null) return
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
