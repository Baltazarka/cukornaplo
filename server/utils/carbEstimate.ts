// Be nem írt (elmaradt) CH utólagos felismerése: óránként (a háttér percenkénti ciklusába illesztve, lásd
// server/plugins/notifier.ts) megnézzük, hogy egy nemrég lezárult (de már „megülepedett”) szakaszban a vércukor
// az akkor felhasznált aktív inzulinnal nem magyarázható emelkedést mutatott-e. Ha igen, és nincs a közelben
// CH-bejegyzés, egy nyugtázásra váró becslés kerül a `carb_estimates` táblába — ez addig NEM számít bele semmilyen
// statisztikába / elemzésbe, amíg a felhasználó a naplóban el nem fogadja (akkor szokásos `entries` sorként,
// `source = ESTIMATED_SOURCE` jelöléssel kerül be).
// A tiszta döntési logika (küszöbök, kerekítés): carbEstimateCore.ts (tesztelt: tests/carbEstimate.test.ts).
import { db } from './db'
import { therapy, segmentAt, blendAt } from './therapy'
import { markDirty } from './computed'
import { glucosePoints } from './digest'
import { rapidDoses, iobAt, maxActionMinutes } from './iob'
import { MEAL_WINDOW_SEC } from './insulinKind'
import { decideCarbEstimate } from './carbEstimateCore'

/** Az elfogadott becslés `entries.source`-a (a naplóban / riportban jelölve, mint az autopilot-korrekció). */
export const ESTIMATED_SOURCE = 'estimated'

/** Ennyi percenként ellenőrzünk (nem minden percben, nincs rá szükség). */
const CHECK_INTERVAL_MIN = 15
/** A vizsgált ablak hossza. */
const WINDOW_LEN_MIN = 90
/** Az ablak vége ennyivel a jelen előtt legyen, hogy az emésztés eleje már lefolyjon. */
const SETTLE_MIN = 60

// Az elutasított (declined) sor is számít: egy elutasítás végleges arra az ablakra, nem csak a következő
// 15 perces ellenőrzésig – különben egy órákig tartó, étel nélküli emelkedés (betegség, stressz) 15 percenként
// újra felkínálná ugyanazt a becslést minden elutasítás után.
function overlapsExisting(windowFrom: number, windowTo: number): boolean {
  return !!db()
    .prepare('SELECT 1 FROM carb_estimates WHERE window_from < ? AND window_to > ? LIMIT 1')
    .get(windowTo, windowFrom)
}

export function checkCarbEstimate(nowTs = Math.floor(Date.now() / 1000)): void {
  const t = therapy()
  if (!t) return
  const last = Number(setting('carb_estimate_check', null)) || 0
  if (nowTs - last < CHECK_INTERVAL_MIN * 60) return
  saveSettings({ carb_estimate_check: nowTs })

  const windowTo = nowTs - SETTLE_MIN * 60
  const windowFrom = windowTo - WINDOW_LEN_MIN * 60
  if (overlapsExisting(windowFrom, windowTo)) return

  const hasCarbsNearby = !!db()
    .prepare("SELECT 1 FROM entries WHERE type = 'carbs' AND ts > ? AND ts <= ? LIMIT 1")
    .get(windowFrom - MEAL_WINDOW_SEC, windowTo)
  if (hasCarbsNearby) return

  const pts = glucosePoints(windowFrom, windowTo + 1).filter((p) => !p.manual)
  const expectedN = WINDOW_LEN_MIN / 5
  const coverage = Math.min(1, pts.length / expectedN)
  if (!pts.length) return
  const startV = pts[0].v
  const endV = pts[pts.length - 1].v

  const carbTs = (db().prepare("SELECT ts FROM entries WHERE type = 'carbs' AND ts >= ? AND ts <= ?").all(windowFrom - maxActionMinutes(t) * 60, windowTo) as { ts: number }[]).map((r) => Number(r.ts))
  const doses = rapidDoses(t, windowFrom - maxActionMinutes(t) * 60, windowTo + 1, carbTs)
  const givenInWindow = doses.filter((d) => d.ts > windowFrom && d.ts <= windowTo).reduce((a, d) => a + d.v, 0)
  const insulinUsed = iobAt(doses, windowFrom) - iobAt(doses, windowTo) + givenInWindow

  const isf = blendAt(t, windowFrom)?.isf ?? segmentAt(t, windowFrom).isf
  const blend = blendAt(t, windowFrom)
  const perG = blend ? blend.isf / blend.icr : isf / segmentAt(t, windowFrom).icr

  const decision = decideCarbEstimate({ startV, endV, coverage, hasCarbsNearby, insulinUsed, isf, perG })
  if (!decision) return

  db().prepare('INSERT INTO carb_estimates (ts, window_from, window_to, grams, status) VALUES (?, ?, ?, ?, ?)')
    .run(windowFrom, windowFrom, windowTo, decision.grams, 'pending')
}

export interface PendingEstimate { id: number; windowFrom: number; windowTo: number; grams: number }

/** A megadott időszakban (ts szerint) függő becslések, a naplóhoz. */
export function pendingEstimates(from: number, to: number): PendingEstimate[] {
  return (db().prepare("SELECT id, window_from, window_to, grams FROM carb_estimates WHERE status = 'pending' AND ts >= ? AND ts < ? ORDER BY ts")
    .all(from, to) as any[]).map((r) => ({ id: Number(r.id), windowFrom: Number(r.window_from), windowTo: Number(r.window_to), grams: Number(r.grams) }))
}

/** Elfogadás: a megadott (a felhasználó által esetleg módosított) grammal normál CH-bejegyzésként kerül a naplóba. */
export function acceptCarbEstimate(id: number, grams: number): { ok: true; id: number } | { ok: false; error: string } {
  const row = db().prepare("SELECT window_from, status FROM carb_estimates WHERE id = ?").get(id) as { window_from: number; status: string } | undefined
  if (!row || row.status !== 'pending') return { ok: false, error: 'A becslés már nem érvényes.' }
  const now = Math.floor(Date.now() / 1000)
  const info = db().prepare("INSERT INTO entries (type, ts, value, source, created_at) VALUES ('carbs', ?, ?, ?, ?)")
    .run(row.window_from, grams, ESTIMATED_SOURCE, now)
  db().prepare("UPDATE carb_estimates SET status = 'accepted', decided_at = ?, acted_entry_id = ? WHERE id = ?")
    .run(now, Number(info.lastInsertRowid), id)
  markDirty()
  return { ok: true, id: Number(info.lastInsertRowid) }
}

export function declineCarbEstimate(id: number): boolean {
  const info = db().prepare("UPDATE carb_estimates SET status = 'declined', decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(Math.floor(Date.now() / 1000), id)
  return Number(info.changes) > 0
}
