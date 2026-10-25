// A legutóbbi (5 órán belüli) zsíros étkezés zsír-fehérje javaslata és az étkezés után beadott inzulin. A bóluskalkulátor
// ebből figyelmeztet, hogy a korrekció és a zsír-fehérje adag átfed, és a push-emlékeztető is ebből dönt.
import { db } from './db'
import { therapy, segmentAt, DEFAULT_FPU_PERCENT } from './therapy'
import { hmInTz } from './time'
import { fpuSuggestion } from '#shared/utils/fpu'

export interface RecentFpu {
  mealTs: number
  time: string
  /** A beíráskor javasolt plusz adag, E. */
  extra: number
  units: number
  hours: number
  pct: number
  /** Az étkezés után 30 perccel kezdődően azóta beadott (nem bázis) inzulin, E: a plusz adag vagy korrekció. */
  givenSince: number
  /** A plusz adag időzítése a beállítás szerint ('together': evéskor egyben). */
  timing: 'later' | 'together'
}

/** Ennyi ideig számít „friss”-nek a zsíros étkezés (a zsír-fehérje hatása eddig tart a legtöbbször). */
const WINDOW_SEC = 5 * 3600
/** Az étkezés saját bólusát (az étkezés körül) nem számítjuk plusz adagnak. */
const AFTER_MEAL_SEC = 30 * 60

/** Az étkezés után 30 perccel kezdődően `nowTs`-ig beadott (nem bázis) inzulin, E: a plusz adag vagy korrekció. */
export function insulinGivenAfterMeal(mealTs: number, nowTs: number): number {
  const rows = db()
    .prepare("SELECT value, subtype FROM entries WHERE type = 'insulin' AND (subtype IS NULL OR subtype != 'basal') AND ts > ? AND ts <= ?")
    .all(mealTs + AFTER_MEAL_SEC, nowTs) as { value: number }[]
  const sum = rows.reduce((s, r) => s + Number(r.value), 0)
  return Math.round(sum * 10) / 10
}

export function recentFpu(nowTs = Math.floor(Date.now() / 1000)): RecentFpu | null {
  const t = therapy()
  if (!t) return null
  const rows = db()
    .prepare("SELECT ts, fat, protein FROM entries WHERE type = 'carbs' AND subtype = 'fatty' AND (fat IS NOT NULL OR protein IS NOT NULL) AND ts > ? AND ts <= ? ORDER BY ts DESC")
    .all(nowTs - WINDOW_SEC, nowTs) as { ts: number; fat: number | null; protein: number | null }[]
  for (const r of rows) {
    const ts = Number(r.ts)
    const f = fpuSuggestion(r.fat, r.protein, segmentAt(t, ts).icr, t.fpuPercent ?? DEFAULT_FPU_PERCENT)
    if (!f || f.extra < 0.5) continue
    return {
      mealTs: ts, time: hmInTz(ts), extra: f.extra, units: f.units, hours: f.hours, pct: f.pct,
      givenSince: insulinGivenAfterMeal(ts, nowTs), timing: t.fpuTiming ?? 'later',
    }
  }
  return null
}
