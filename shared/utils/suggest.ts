// Az inzulinjavaslat mennyisége (a „mikor” feltételeket a predict.ts nézi). Pumpa-szerű elv (oref1 SMB): egy lépésben
// csak a teljes szükséglet töredéke jön (újraszámolás követi), és a javaslat arra az adagra kerekítve (lefelé), amit a
// tollal be tudsz adni (alap 1 E). Tájékoztató számítás: a beadásról a felhasználó dönt.

/** A teljes szükséglet hány része egy javaslat. */
export const SUGGEST_FRACTION = 0.5

const floorTo = (x: number, step: number) => Math.floor(x / step + 1e-9) * step

export interface SuggestInput {
  /** Hosszú távon kialakuló vércukor, mmol/L (aktív inzulin és CH teljes hatásával). */
  eventual: number
  target: number
  /** mmol/L / E */
  isf: number
  maxBolus: number
  /** A toll adagolási lépésköze, E (0,5 vagy 1). */
  step: number
}

/** { units: a javasolt adag, full: a teljes szükséglet } vagy null, ha egy lépésnyi sincs. */
export function suggestInsulin(i: SuggestInput): { units: number; full: number } | null {
  const need = (i.eventual - i.target) / i.isf
  if (!(need > 0)) return null
  const units = Math.min(floorTo(i.maxBolus, i.step), floorTo(need * SUGGEST_FRACTION, i.step))
  if (units < i.step) return null
  return { units, full: Math.round(need * 10) / 10 }
}
