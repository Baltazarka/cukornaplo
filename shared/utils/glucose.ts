// A Guardian szenzor mérési tartománya 40–400 mg/dL (2,2–22,2 mmol/L): ezen kívül a határértéket küldi
// (pl. hipóban percekig 40 mg/dL-t), a valós érték ennél kisebb/nagyobb is lehet. Ezért a határon lévő
// szenzorérték „<2,2” / „>22,2” formában jelenik meg. A számítások a határértékkel dolgoznak.
export const SG_FLOOR = 2.2
export const SG_CEIL = 22.2

/** Egy szenzorérték szövegként (mmol/L), a mérési tartomány határán „<2,2” / „>22,2”. */
export function sgText(v: number | null | undefined, dec = 1): string {
  if (v == null || !Number.isFinite(v)) return '–'
  const f = (x: number) => x.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  if (v <= SG_FLOOR) return `<${f(SG_FLOOR)}`
  if (v >= SG_CEIL) return `>${f(SG_CEIL)}`
  return f(v)
}
