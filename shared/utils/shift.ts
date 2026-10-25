// Váltott műszak (délelőttös / délutános hét): a beállított hét és onnan hetente váltakozva, hétvégén (ha így van
// beállítva) szabadnap; egyes napok kézzel átállíthatók (pl. szabadság). A szerver (terápiás profil, elemzés) és a
// felület közös számolása.
import type { ShiftKind, ShiftSchedule, Therapy } from '../types/therapy'

export const SHIFT_LABEL: Record<ShiftKind, string> = { morning: 'Délelőttös', afternoon: 'Délutános', free: 'Szabadnap' }
export const SHIFT_KINDS: ShiftKind[] = ['morning', 'afternoon', 'free']

const DAY_MS = 86_400_000
const utc = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const ymdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** A hét hétfője (YYYY-MM-DD). */
export function mondayOf(ymd: string): string {
  const ms = utc(ymd)
  const dow = (new Date(ms).getUTCDay() + 6) % 7 // hétfő = 0
  return ymdOf(ms - dow * DAY_MS)
}

/** A műszak a beosztás szerint (kézi átállítás nélkül); null, ha nincs beosztás. */
export function scheduledShift(s: ShiftSchedule | null | undefined, ymd: string): ShiftKind | null {
  if (!s?.enabled || !/^\d{4}-\d{2}-\d{2}$/.test(s.anchor ?? '')) return null
  const dow = new Date(utc(ymd)).getUTCDay()
  if (s.weekendFree && (dow === 0 || dow === 6)) return 'free'
  const weeks = Math.round((utc(mondayOf(ymd)) - utc(mondayOf(s.anchor))) / (7 * DAY_MS))
  const same = ((weeks % 2) + 2) % 2 === 0
  return same ? s.anchorShift : s.anchorShift === 'morning' ? 'afternoon' : 'morning'
}

/** Az adott nap műszakja (a kézi átállítással); null, ha nincs beosztás. */
export function shiftOf(s: ShiftSchedule | null | undefined, ymd: string): ShiftKind | null {
  if (!s?.enabled) return null
  return s.overrides?.[ymd] ?? scheduledShift(s, ymd)
}

/** Melyik terápiás profil érvényes: 'alt' a délutános hétre beállított, különben az alap (délelőttös / általános). */
export function profileFor(t: Pick<Therapy, 'altEnabled' | 'altSegments' | 'freeProfile'> | null | undefined, shift: ShiftKind | null): 'base' | 'alt' {
  if (!t?.altEnabled || !t.altSegments?.length || !shift) return 'base'
  if (shift === 'afternoon') return 'alt'
  if (shift === 'free') return t.freeProfile === 'alt' ? 'alt' : 'base'
  return 'base'
}
