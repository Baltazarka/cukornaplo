// Inzulinadagok besorolása: étkezési bólus, korrekció vagy bázis.
// A Health-adatban csak „bólus” vagy „bázis” szerepel, ezért a bólusokat becsüljük:
//  - ha a beadás után 60 percen belül (előbólus) vagy előtte 30 percen belül szénhidrát is van → étkezési bólus;
//  - ha nincs szénhidrát, de a vércukor a beadáskor a napszak célértéke + 2 mmol/L alatt volt →
//    étkezési bólus szénhidrát nélkül (valószínűleg étkezés volt, csak a CH nem lett beírva);
//  - különben (magas vércukor, vagy nincs mérés) → korrekció.
// A naplóban kézzel beállított típus (subtype: meal / correction / basal) mindig felülírja a becslést.
import type { StatementSync } from 'node:sqlite'
import { db } from './db'
import { therapy, segmentAt } from './therapy'

export type InsulinKind = 'meal' | 'correction' | 'basal'

export const MEAL_WINDOW_SEC = 30 * 60
/** Előbólus: az étkezés (CH) előtt legfeljebb ennyivel beadott bólus is étkezési. */
export const PREBOLUS_SEC = 60 * 60
/** Ennyivel a célérték fölött már korrekciónak tekintjük a szénhidrát nélküli bólust (mmol/L). */
export const CORRECTION_MARGIN = 2
/** Célérték, ha nincs terápiás beállítás (mmol/L). */
const DEFAULT_TARGET = 6

let glucoseStmt: StatementSync | null = null
/** A beadáskori vércukor: a 15 perccel előtte és 5 perccel utána mért értékek közül a legközelebbi. */
function glucoseAt(ts: number): number | null {
  glucoseStmt ??= db().prepare(
    "SELECT value FROM entries WHERE type = 'glucose' AND ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) LIMIT 1",
  )
  const row = glucoseStmt.get(ts - 900, ts + 300, ts) as { value: number } | undefined
  return row ? Number(row.value) : null
}

/**
 * Egy adag típusa. `carbTs`: a környező szénhidrát-bejegyzések időpontjai (unix mp).
 * `auto`: becslés (nem kézi beállítás); `noCarbs`: étkezési bólus, amelyhez nincs CH beírva.
 */
export function insulinKind(ts: number, subtype: string | null, carbTs: number[]): { kind: InsulinKind; auto: boolean; noCarbs: boolean } {
  if (subtype === 'basal' || subtype === 'meal' || subtype === 'correction') return { kind: subtype, auto: false, noCarbs: false }
  if (carbTs.some((c) => c - ts >= -MEAL_WINDOW_SEC && c - ts <= PREBOLUS_SEC)) return { kind: 'meal', auto: true, noCarbs: false }
  const bg = glucoseAt(ts)
  const t = therapy()
  const target = t ? segmentAt(t, ts).target : DEFAULT_TARGET
  if (bg != null && bg < target + CORRECTION_MARGIN) return { kind: 'meal', auto: true, noCarbs: true }
  return { kind: 'correction', auto: true, noCarbs: false }
}
