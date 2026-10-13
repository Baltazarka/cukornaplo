// Bóluskalkulátor (a Medtronic bóluskalkulátorok logikája szerint):
//  - étkezési adag = szénhidrát ÷ CH-arány (g/E);
//  - korrekció = (vércukor − célérték) ÷ érzékenység (mmol/L/E);
//  - a még aktív inzulin célérték fölött csak a korrekcióból vonódik le (nulláig), az étkezési adagból nem;
//  - célérték alatti vércukornál a negatív korrekció csökkenti az étkezési adagot, és (óvatosságból,
//    a Medtronic-logikánál szigorúbban) a még aktív inzulin is levonódik belőle, hiszen az még tovább
//    csökkenti a vércukrot; a levonás a célértéknél nulláról indul, és `IOB_RAMP` mmol/L-rel a cél alatt éri el
//    a teljeset, így a javaslat a célérték körül folytonos (nincs ugrás egy tizednyi vércukor-eltérésnél);
//  - a végeredmény a toll lépésközére lefelé kerekítve, a maximális dózisnál nem több.
// Tájékoztató számítás: a beadott adagról mindig a felhasználó dönt.

export interface BolusInput {
  carbs: number
  /** Vércukor mmol/L; null: nincs mérés, nincs korrekció. */
  bg: number | null
  target: number
  isf: number
  icr: number
  /** Még aktív gyors hatású inzulin, E. */
  iob: number
  maxBolus: number
  /** A toll adagolási lépésköze, E. */
  step?: number
}

export interface BolusResult {
  carbDose: number
  /** Nyers korrekció (negatív is lehet). */
  correction: number
  /** A levont aktív inzulin (célérték fölött a korrekcióból, alatta az étkezési adagból). */
  iobUsed: number
  /** Célérték alatt az aktív inzulin az étkezési adagból vonódott le. */
  iobFromMeal: boolean
  /** Kerekítés előtti összeg. */
  total: number
  /** Javasolt adag: lefelé kerekítve, a maximális dózisra korlátozva. */
  dose: number
  capped: boolean
}

/** Ennyi mmol/L-rel a célérték alatt vonódik le a teljes (étkezésből levonandó) aktív inzulin; fölötte arányosan. */
export const IOB_RAMP = 1.0

export function calcBolus(i: BolusInput): BolusResult {
  const step = i.step ?? 0.5
  const carbDose = i.carbs > 0 && i.icr > 0 ? i.carbs / i.icr : 0
  const correction = i.bg != null && i.isf > 0 ? (i.bg - i.target) / i.isf : 0
  const iob = Math.max(i.iob, 0)
  // A pozitív korrekcióból levonódó rész; a maradék aktív inzulin csak a célérték alatt csökkenti az étkezési adagot.
  const fromCorrection = Math.min(iob, Math.max(correction, 0))
  const below = i.bg != null ? Math.min(1, Math.max(0, (i.target - i.bg) / IOB_RAMP)) : 0
  const fromMeal = Math.min((iob - fromCorrection) * below, Math.max(0, carbDose + Math.min(correction, 0)))
  const iobFromMeal = fromMeal > 0
  const iobUsed = fromCorrection + fromMeal
  const total = Math.max(0, carbDose + correction - iobUsed)
  // Lebegőpontos hiba ellen: 6,9999… ne kerekedjen 6,5-re.
  let dose = Math.floor(total / step + 1e-9) * step
  const capped = dose > i.maxBolus
  if (capped) dose = Math.floor(i.maxBolus / step + 1e-9) * step
  return { carbDose, correction, iobUsed, iobFromMeal, total, dose, capped }
}
