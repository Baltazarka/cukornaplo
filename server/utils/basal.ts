// A bázisinzulin (Toujeo) külön tollal megy, az InPen csak akkor tud róla, ha beírod az appba.
// Ha egy lezárt napon nincs bázis a naplóban, a TDD és a bólus/bázis arány a beállított
// bázisadaggal számol („becsült”), hogy ne tűnjön úgy, mintha aznap nem lett volna bázis.

/** A főoldalon beállított bázisadag (E), vagy null. */
export function assumedBasalDose(): number | null {
  const v = Number(setting('basal_dose', null))
  return Number.isFinite(v) && v > 0 ? v : null
}
