// Inzulinadagok besorolása: étkezési bólus, korrekció vagy bázis.
// A Health-adatban csak „bólus” vagy „bázis” szerepel, ezért a bólusokat becsüljük: ha a beadás
// előtt vagy után 30 percen belül van szénhidrát, étkezési, különben korrekció. A naplóban kézzel
// beállított típus (subtype: meal / correction / basal) mindig felülírja a becslést.

export type InsulinKind = 'meal' | 'correction' | 'basal'

export const MEAL_WINDOW_SEC = 30 * 60

/** A kézzel vagy forrásból megadott típus; null = becsülni kell. */
function fixedKind(subtype: string | null): InsulinKind | null {
  return subtype === 'basal' || subtype === 'meal' || subtype === 'correction' ? subtype : null
}

/**
 * Egy adag típusa. `carbTs`: a környező szénhidrát-bejegyzések időpontjai (unix mp, bármilyen sorrendben).
 * `auto`: igaz, ha becslés (nem kézi beállítás).
 */
export function insulinKind(ts: number, subtype: string | null, carbTs: number[]): { kind: InsulinKind; auto: boolean } {
  const fixed = fixedKind(subtype)
  if (fixed) return { kind: fixed, auto: false }
  const meal = carbTs.some((c) => Math.abs(c - ts) <= MEAL_WINDOW_SEC)
  return { kind: meal ? 'meal' : 'correction', auto: true }
}
