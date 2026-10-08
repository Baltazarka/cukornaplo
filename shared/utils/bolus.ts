// Bóluskalkulátor (a Medtronic bóluskalkulátorok logikája szerint):
//  - étkezési adag = szénhidrát ÷ CH-arány (g/E);
//  - korrekció = (vércukor − célérték) ÷ érzékenység (mmol/L/E);
//  - a még aktív inzulin csak a pozitív korrekcióból vonódik le (nulláig), az étkezési adagból nem;
//  - célérték alatti vércukornál a negatív korrekció csökkenti az étkezési adagot;
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
  /** A korrekcióból levont aktív inzulin. */
  iobUsed: number
  /** Kerekítés előtti összeg. */
  total: number
  /** Javasolt adag: lefelé kerekítve, a maximális dózisra korlátozva. */
  dose: number
  capped: boolean
}

export function calcBolus(i: BolusInput): BolusResult {
  const step = i.step ?? 0.5
  const carbDose = i.carbs > 0 && i.icr > 0 ? i.carbs / i.icr : 0
  const correction = i.bg != null && i.isf > 0 ? (i.bg - i.target) / i.isf : 0
  const iobUsed = correction > 0 ? Math.min(Math.max(i.iob, 0), correction) : 0
  const total = Math.max(0, carbDose + correction - iobUsed)
  // Lebegőpontos hiba ellen: 6,9999… ne kerekedjen 6,5-re.
  let dose = Math.floor(total / step + 1e-9) * step
  const capped = dose > i.maxBolus
  if (capped) dose = Math.floor(i.maxBolus / step + 1e-9) * step
  return { carbDose, correction, iobUsed, total, dose, capped }
}
