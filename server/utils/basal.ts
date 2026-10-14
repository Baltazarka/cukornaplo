// A bázisinzulin (Toujeo) külön tollal megy, az InPen csak akkor tud róla, ha beírod az appba.
// Ha egy lezárt napon nincs bázis a naplóban, a TDD és a bólus/bázis arány a beállított
// bázisadaggal számol („becsült”), hogy ne tűnjön úgy, mintha aznap nem lett volna bázis.

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
