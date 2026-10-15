// Zsír-fehérje egység (FPU, Pankowska / varsói módszer): a zsír és a fehérje késői (1–1,5 óra múlva kezdődő,
// órákig tartó) vércukor-emelése. 1 egység = 100 kcal zsírból és fehérjéből; eredetileg annyi inzulin kell hozzá,
// mint 10 g szénhidráthoz, a mennyiségtől függően 3–8 óra alatt elnyújtva. A javaslat ennek a beállított %-a.
// Közös a bóluskalkulátor, a szerver (emlékeztető) és az elemzés (saját % becslése) számára.

/** Ennyi g CH-nak felel meg 1 zsír-fehérje egység a varsói módszerben. */
export const FPU_CARB_G = 10
/** A zsír / fehérje beírható legnagyobb mennyisége, g. */
export const MACRO_MAX_G = 300

/** Zsír-fehérje egység 0,1-re kerekítve: (zsír × 9 + fehérje × 4) ÷ 100. */
export function fpuUnits(fat: number | null | undefined, protein: number | null | undefined): number {
  const f = Math.max(0, Number(fat) || 0)
  const p = Math.max(0, Number(protein) || 0)
  return Math.round(((f * 9 + p * 4) / 100) * 10) / 10
}

/** A hatás hossza, óra: 1 egység 3, 2 egység 4, 3 egység 5, 4 vagy több egység 8 óra. */
export function fpuHours(units: number): number {
  return units < 1.5 ? 3 : units < 2.5 ? 4 : units < 4 ? 5 : 8
}

export interface FpuSuggestion {
  units: number
  /** A CH-egyenérték, g. */
  carbEq: number
  /** Javasolt plusz adag, E (a %-kal, 0,5 E-re lefelé kerekítve; 0, ha 0,5 E alatt van). */
  extra: number
  hours: number
  pct: number
}

/** A javaslat egy étkezésre; null, ha nincs érdemi zsír-fehérje (0,5 egység alatt) vagy a javaslat ki van kapcsolva. */
export function fpuSuggestion(fat: number | null | undefined, protein: number | null | undefined, icr: number, pct: number): FpuSuggestion | null {
  const units = fpuUnits(fat, protein)
  if (units < 0.5 || !pct || !(icr > 0)) return null
  const carbEq = units * FPU_CARB_G
  const extra = Math.floor(((carbEq / icr) * pct) / 100 * 2) / 2
  return { units, carbEq, extra, hours: fpuHours(units), pct }
}
