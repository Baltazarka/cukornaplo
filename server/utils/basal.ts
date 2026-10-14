// A beállított bázisadag (Toujeo): csak a típus nélküli adagok bázisként való felismeréséhez kell.
// A napi összinzulin és a bázisarány mindig csak a naplózott adagokból számol (nincs becsült bázis).

import { therapy } from './therapy'
import { looksBasal } from './normalize'

/** A főoldalon beállított bázisadag (E), vagy null. */
export function assumedBasalDose(): number | null {
  const v = Number(setting('basal_dose', null))
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * Típus nélküli adag (nincs kézzel beállított altípus), amely bázisnak számít (lásd looksBasal: a bázisadag, vagy
 * a maximális bólus fölött a bázisadag ±25%-a).
 * Minden útvonalon (adatfogadás, import, kézi felvétel, elemzés) ugyanez a szabály érvényes.
 */
export function isAssumedBasal(value: number, subtype: string | null): boolean {
  if (subtype != null && subtype !== '') return false
  return looksBasal(value, assumedBasalDose(), therapy()?.maxBolus ?? null)
}
